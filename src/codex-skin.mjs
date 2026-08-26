import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumerateWallpaperSources } from './wallpaper-engine.mjs';

const DEFAULT_CDP_PORT = Number(process.env.CODEX_SKIN_CDP_PORT || 9222);
const LAYER_ID = 'codex-wallpaper-engine-skin';

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] || 'application/octet-stream';
}

export function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function inlineMedia(file, maxBytes) {
  if (!file || !existsSync(file)) throw new Error('The selected project media is missing.');
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error(`Media is too large to embed safely (${stat.size} bytes).`);
  return `data:${mimeFor(file)};base64,${readFileSync(file).toString('base64')}`;
}

function extractVideoAnimation(file) {
  const workDir = mkdtempSync(join(tmpdir(), 'codex-skin-frame-'));
  const output = join(workDir, 'frames');
  const script = fileURLToPath(new URL('../scripts/extract-video-frames.ps1', import.meta.url));
  try {
    const rawMetadata = execFileSync('pwsh.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', script,
      '-InputPath', file, '-OutputDirectory', output,
      '-FrameCount', '60', '-DurationSeconds', '4', '-MaxWidth', '1280', '-JpegQuality', '75',
    ], { encoding: 'utf8', windowsHide: true, timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const metadata = JSON.parse(rawMetadata);
    const files = readdirSync(output).filter((name) => /\.jpg$/i.test(name)).sort();
    if (files.length < 4) throw new Error('Too few decoded video frames.');
    const totalBytes = files.reduce((sum, name) => sum + statSync(join(output, name)).size, 0);
    if (totalBytes > 48 * 1024 * 1024) throw new Error('Decoded animation is too large to embed safely.');
    const mediaFrames = files.map((name) => inlineMedia(join(output, name), 4 * 1024 * 1024));
    return {
      mediaUrl: mediaFrames[0], mediaFrames, frameDelayMs: metadata.frameDelayMs,
      frameRate: metadata.frameRate,
      sourceResolution: `${metadata.sourceWidth}x${metadata.sourceHeight}`,
      renderResolution: `${metadata.renderWidth}x${metadata.renderHeight}`,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function transcodeVideoForCodex(file) {
  const source = statSync(file);
  const minimumBytes = Math.max(1, Number(process.env.CODEX_SKIN_COMPRESS_MIN_MB || 48)) * 1024 * 1024;
  if (process.env.CODEX_SKIN_DISABLE_COMPRESSION === '1' || source.size < minimumBytes) return null;
  const cacheRoot = join(process.env.LOCALAPPDATA || tmpdir(), 'CodexWallpaperEngineSkin', 'transcoded');
  mkdirSync(cacheRoot, { recursive: true });
  const settings = { maxWidth: 2560, maxHeight: 1440, bitrateKbps: 10000, frameRate: 30 };
  const key = createHash('sha256')
    .update(`${resolve(file)}\n${source.size}\n${source.mtimeMs}\n${JSON.stringify(settings)}`)
    .digest('hex').slice(0, 24);
  const output = join(cacheRoot, `${key}.mp4`);
  const metadataFile = join(cacheRoot, `${key}.json`);
  if (existsSync(output) && statSync(output).size > 0 && existsSync(metadataFile)) {
    return { filePath: output, ...JSON.parse(readFileSync(metadataFile, 'utf8')), cached: true };
  }
  const partial = join(cacheRoot, `${key}.${process.pid}.partial.mp4`);
  const script = fileURLToPath(new URL('../scripts/transcode-video.ps1', import.meta.url));
  try {
    const raw = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-InputPath', file, '-OutputPath', partial,
      '-MaxWidth', String(settings.maxWidth), '-MaxHeight', String(settings.maxHeight),
      '-VideoBitrateKbps', String(settings.bitrateKbps), '-MaxFrameRate', String(settings.frameRate),
    ], { encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const metadata = JSON.parse(raw);
    if (!existsSync(partial) || statSync(partial).size < 1024) throw new Error('The compressed video output is empty.');
    renameSync(partial, output);
    const result = {
      originalBytes: source.size,
      outputBytes: statSync(output).size,
      sourceResolution: `${metadata.sourceWidth}x${metadata.sourceHeight}`,
      renderResolution: `${metadata.outputWidth}x${metadata.outputHeight}`,
      frameRate: metadata.frameRate,
      bitrateKbps: metadata.bitrateKbps,
    };
    writeFileSync(metadataFile, JSON.stringify(result));
    return { filePath: output, ...result, cached: false };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

export function selectEmbeddableMedia(project) {
  const maxVideoBytes = Math.max(1, Number(process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB || 24)) * 1024 * 1024;
  const maxBlobVideoBytes = Math.max(32, Number(process.env.CODEX_SKIN_BLOB_VIDEO_MAX_MB || 512)) * 1024 * 1024;
  if (project.type === 'video' && existsSync(project.filePath) && statSync(project.filePath).size <= maxVideoBytes) {
    return { mediaUrl: inlineMedia(project.filePath, maxVideoBytes), mode: 'video', fallback: false, fallbackKind: null };
  }
  let compressed = null;
  if (project.type === 'video' && existsSync(project.filePath)) {
    try { compressed = transcodeVideoForCodex(project.filePath); } catch { /* use the original video */ }
  }
  const blobVideoPath = compressed?.filePath || project.filePath;
  if (project.type === 'video' && process.env.CODEX_SKIN_DISABLE_BLOB_VIDEO !== '1'
      && existsSync(blobVideoPath) && statSync(blobVideoPath).size <= maxBlobVideoBytes) {
    const poster = project.previewPath ? inlineMedia(project.previewPath, 24 * 1024 * 1024) : null;
    return {
      mediaUrl: poster, mode: 'video-blob', fallback: false, fallbackKind: null,
      videoPath: blobVideoPath, videoBytes: statSync(blobVideoPath).size,
      compressed: Boolean(compressed), originalBytes: compressed?.originalBytes || null,
      compressionRatio: compressed ? compressed.outputBytes / compressed.originalBytes : null,
      sourceResolution: compressed?.sourceResolution || null,
      renderResolution: compressed?.renderResolution || null,
      frameRate: compressed?.frameRate || null,
      bitrateKbps: compressed?.bitrateKbps || null,
      compressionCached: compressed?.cached || false,
    };
  }
  if (project.type === 'video' && process.env.CODEX_SKIN_DISABLE_FRAME_EXTRACTION !== '1') {
    try {
      const animation = extractVideoAnimation(project.filePath);
      return { ...animation, mode: 'frames', fallback: true, fallbackKind: 'extracted-video-animation' };
    } catch { /* fall through to the project preview */ }
  }
  if (project.previewPath) {
    return { mediaUrl: inlineMedia(project.previewPath, 24 * 1024 * 1024), mode: 'preview', fallback: project.type !== 'scene', fallbackKind: 'project-preview' };
  }
  throw new Error('Codex blocks local media URLs and this project has no embeddable preview image.');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.scriptId = null;
    this.onEvent = null;
  }

  async connect() {
    if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required for the skin bridge.');
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to the Codex debug target.')), 5000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to the Codex debug target.')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.method) {
        try { this.onEvent?.(message); } catch { /* isolate event handlers from CDP calls */ }
        return;
      }
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve: done, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else done(message.result || {});
    });
    this.socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Codex debug target disconnected.'));
      this.pending.clear();
    });
  }

  call(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Codex debug target is not connected.');
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket?.close(); } catch { /* ignore */ }
  }
}

export function makeInjectionScript({ mediaUrl, mediaFrames = [], frameDelayMs = 250, mode, panelOpacity = 0.68, scrimOpacity = 0.22, blurPx = 16, muted = true, fitMode = 'cover', zoom = 100, positionX = 50, positionY = 50, showControls = true, sourceOptions = [], currentId = null }) {
  const config = JSON.stringify({ mediaUrl, mediaFrames, frameDelayMs, mode, panelOpacity, scrimOpacity, blurPx, muted, fitMode, zoom, positionX, positionY, showControls, sourceOptions, currentId });
  return `(() => {
    const cfg = ${config};
    const id = ${JSON.stringify(LAYER_ID)};
    document.getElementById(id)?.remove();
    document.getElementById(id + '-style')?.remove();
    document.getElementById(id + '-controls')?.remove();
    window.__codexWallpaperPauseCleanup?.();
    if (window.__codexWallpaperFrameTimer) cancelAnimationFrame(window.__codexWallpaperFrameTimer);
    window.__codexWallpaperFrameCache = null;
    if (window.__codexWallpaperBlobUrl) URL.revokeObjectURL(window.__codexWallpaperBlobUrl);
    window.__codexWallpaperBlobUrl = null;
    window.__codexWallpaperVideoChunks = null;

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--codex-skin-panel-opacity', cfg.panelOpacity);
    rootStyle.setProperty('--codex-skin-blur', cfg.blurPx + 'px');

    const layer = document.createElement('div');
    layer.id = id;
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '0', overflow: 'hidden', pointerEvents: 'none', background: '#0b0d10' });
    let media;
    let resumeFrames = null;
    if (cfg.mode === 'frames') {
      media = document.createElement('canvas');
    } else if (cfg.mode === 'video' || cfg.mode === 'video-blob') {
      media = document.createElement('video');
      media.autoplay = true; media.loop = true; media.muted = cfg.muted; media.playsInline = true;
    } else if (cfg.mode === 'web') {
      media = document.createElement('iframe');
      media.sandbox = 'allow-scripts allow-same-origin';
      media.tabIndex = -1;
    } else {
      media = document.createElement('img');
    }
    if (cfg.mode === 'video-blob') {
      if (cfg.mediaUrl) media.poster = cfg.mediaUrl;
    } else if (cfg.mode !== 'frames') {
      media.src = cfg.mediaUrl;
    }
    Object.assign(media.style, {
      width: '100%', height: '100%', objectFit: cfg.fitMode,
      objectPosition: cfg.positionX + '% ' + cfg.positionY + '%',
      transform: 'scale(' + (cfg.zoom / 100) + ')', transformOrigin: 'center',
      border: '0', pointerEvents: 'none', imageRendering: 'auto'
    });
    if (cfg.mode === 'frames' && cfg.mediaFrames.length > 1) {
      const frames = cfg.mediaFrames.map(src => { const image = new Image(); image.decoding = 'async'; image.src = src; return image; });
      window.__codexWallpaperFrameCache = frames;
      const context = media.getContext('2d', { alpha: false });
      let canvasSized = false;
      const draw = image => {
        if (!canvasSized) { media.width = image.naturalWidth; media.height = image.naturalHeight; canvasSized = true; }
        context.drawImage(image, 0, 0, media.width, media.height);
      };
      if (frames[0].complete) draw(frames[0]); else frames[0].addEventListener('load', () => draw(frames[0]), { once: true });
      Promise.allSettled(frames.map(image => image.decode())).then(() => {
        const delay = Math.max(33, cfg.frameDelayMs);
        let frameIndex = 0;
        let previousTime = performance.now();
        const renderFrame = now => {
          if (codexInactive()) { window.__codexWallpaperFrameTimer = null; return; }
          if (now - previousTime >= delay) {
            frameIndex = (frameIndex + Math.max(1, Math.floor((now - previousTime) / delay))) % frames.length;
            previousTime = now;
          }
          if (frames[frameIndex].complete) {
            draw(frames[frameIndex]);
          }
          window.__codexWallpaperFrameTimer = requestAnimationFrame(renderFrame);
        };
        resumeFrames = () => {
          if (window.__codexWallpaperFrameTimer || codexInactive()) return;
          previousTime = performance.now();
          window.__codexWallpaperFrameTimer = requestAnimationFrame(renderFrame);
        };
        resumeFrames();
      });
    }
    layer.appendChild(media);
    const scrim = document.createElement('div');
    Object.assign(scrim.style, { position: 'absolute', inset: '0', background: 'rgba(0,0,0,' + cfg.scrimOpacity + ')' });
    layer.appendChild(scrim);

    let playbackStatus = null;
    let playbackProgressTrack = null;
    let playbackProgressFill = null;
    const setLoadingProgress = (percent, state = 'loading') => {
      if (!playbackProgressTrack || !playbackProgressFill) return;
      playbackProgressTrack.style.display = 'block';
      playbackProgressFill.style.background = state === 'error' ? '#ef5350' : (state === 'done' ? '#45c97a' : '#4aa3ff');
      if (percent === null) {
        playbackProgressTrack.removeAttribute('aria-valuenow');
        playbackProgressFill.style.width = '28%';
        playbackProgressFill.style.transform = 'translateX(-140%)';
        playbackProgressFill.style.animation = 'codex-skin-progress-indeterminate 1.1s ease-in-out infinite';
      } else {
        playbackProgressTrack.setAttribute('aria-valuemin', '0');
        playbackProgressTrack.setAttribute('aria-valuemax', '100');
        playbackProgressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
        playbackProgressFill.style.animation = 'none';
        playbackProgressFill.style.transform = 'none';
        playbackProgressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
      }
    };
    const codexInactive = () => document.hidden || !document.hasFocus();
    const syncPlayback = () => {
      if (media instanceof HTMLVideoElement) {
        if (codexInactive()) media.pause();
        else if (media.src) media.play().catch(() => {});
      }
      if (cfg.mode === 'frames') {
        if (codexInactive() && window.__codexWallpaperFrameTimer) {
          cancelAnimationFrame(window.__codexWallpaperFrameTimer);
          window.__codexWallpaperFrameTimer = null;
        } else if (!codexInactive()) resumeFrames?.();
      }
      if (playbackStatus && codexInactive()) {
        playbackStatus.textContent = '已暂停（Codex 未激活）';
      } else if (playbackStatus && media instanceof HTMLVideoElement && (cfg.mode !== 'video-blob' || window.__codexWallpaperBlobUrl)) {
        playbackStatus.textContent = '原视频播放中 · 离开 Codex 自动暂停';
      } else if (playbackStatus && cfg.mode === 'frames') {
        playbackStatus.textContent = '预览动画播放中 · 离开 Codex 自动暂停';
      }
    };
    const playbackEvents = [['visibilitychange', syncPlayback, document], ['focus', syncPlayback, window], ['blur', syncPlayback, window]];
    playbackEvents.forEach(([name, handler, target]) => target.addEventListener(name, handler));
    window.__codexWallpaperPauseCleanup = () => playbackEvents.forEach(([name, handler, target]) => target.removeEventListener(name, handler));
    window.__codexWallpaperSyncPlayback = syncPlayback;
    window.__codexWallpaperBeginVideo = (token, totalBytes) => {
      if (window.__codexWallpaperBlobUrl) URL.revokeObjectURL(window.__codexWallpaperBlobUrl);
      window.__codexWallpaperBlobUrl = null;
      window.__codexWallpaperVideoChunks = { token, totalBytes, received: 0, chunks: [] };
      if (playbackStatus) playbackStatus.textContent = '正在加载原视频 0%';
      setLoadingProgress(0);
      return true;
    };
    window.__codexWallpaperPushVideoChunk = (token, base64) => {
      const transfer = window.__codexWallpaperVideoChunks;
      if (!transfer || transfer.token !== token) return false;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      transfer.chunks.push(bytes);
      transfer.received += bytes.length;
      const percent = Math.min(100, Math.round(transfer.received / transfer.totalBytes * 100));
      if (playbackStatus) playbackStatus.textContent = '正在加载原视频 ' + percent + '%';
      setLoadingProgress(percent);
      return true;
    };
    window.__codexWallpaperFinishVideo = (token, mime) => {
      const transfer = window.__codexWallpaperVideoChunks;
      if (!transfer || transfer.token !== token) return false;
      const blob = new Blob(transfer.chunks, { type: mime });
      window.__codexWallpaperVideoChunks = null;
      window.__codexWallpaperBlobUrl = URL.createObjectURL(blob);
      media.src = window.__codexWallpaperBlobUrl;
      syncPlayback();
      if (playbackStatus && !codexInactive()) playbackStatus.textContent = '原视频播放中 · 离开 Codex 自动暂停';
      setLoadingProgress(100, 'done');
      return true;
    };
    window.__codexWallpaperVideoError = message => {
      window.__codexWallpaperVideoChunks = null;
      if (playbackStatus) playbackStatus.textContent = '视频加载失败：' + message;
      setLoadingProgress(100, 'error');
    };

    const style = document.createElement('style');
    style.id = id + '-style';
    style.textContent = [
      'html,body{background:transparent!important}',
      'body>div:not(#' + id + '):not(#' + id + '-controls){position:relative!important;z-index:1!important;background:transparent!important}',
      'main,aside,nav,header,section,[role="navigation"],[role="main"],[class*="bg-surface"],[class*="bg-elevated"]{background-color:rgba(20,22,26,var(--codex-skin-panel-opacity))!important;backdrop-filter:blur(var(--codex-skin-blur)) saturate(1.12)!important}',
      '[data-radix-popper-content-wrapper],[role="dialog"],[role="menu"]{backdrop-filter:blur(var(--codex-skin-blur))!important}',
      '@keyframes codex-skin-progress-indeterminate{0%{transform:translateX(-140%)}100%{transform:translateX(360%)}}'
    ].join('\\n');
    document.head.appendChild(style);
    document.body.prepend(layer);

    if (cfg.showControls && location.protocol === 'app:' && !location.search.includes('avatar-overlay')) {
      const controls = document.createElement('div');
      controls.id = id + '-controls';
      Object.assign(controls.style, {
        position: 'fixed', right: '18px', bottom: '88px', zIndex: '2147483647',
        width: '270px', color: '#fff', font: '12px system-ui', pointerEvents: 'auto'
      });
      const toggle = document.createElement('button');
      toggle.textContent = '皮肤调整';
      Object.assign(toggle.style, {
        float: 'right', border: '1px solid rgba(255,255,255,.18)', borderRadius: '10px',
        padding: '7px 11px', color: '#fff', background: 'rgba(15,17,21,.88)', cursor: 'pointer'
      });
      const panel = document.createElement('div');
      Object.assign(panel.style, {
        display: window.__codexWallpaperControlsOpen ? 'block' : 'none', clear: 'both', marginTop: '40px', padding: '12px', borderRadius: '12px',
        border: '1px solid rgba(255,255,255,.16)', background: 'rgba(15,17,21,.94)',
        boxShadow: '0 12px 40px rgba(0,0,0,.4)', backdropFilter: 'blur(18px)'
      });
      const title = document.createElement('div');
      title.textContent = 'Wallpaper Engine 皮肤';
      Object.assign(title.style, { fontWeight: '650', fontSize: '13px', marginBottom: '10px' });
      panel.appendChild(title);
      if (cfg.sourceOptions.length) {
        const sourceRow = document.createElement('label');
        sourceRow.style.cssText = 'display:grid;grid-template-columns:76px 1fr;align-items:center;gap:7px;margin:7px 0';
        const sourceLabel = document.createElement('span'); sourceLabel.textContent = '视频';
        const source = document.createElement('select');
        source.style.cssText = 'min-width:0;background:#24272d;color:#fff;border:1px solid #4a4f58;border-radius:6px;padding:4px';
        cfg.sourceOptions.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; option.selected = item.id === cfg.currentId; source.appendChild(option); });
        source.addEventListener('change', () => {
          if (typeof window.codexSkinCommand !== 'function') return;
          playbackStatus.textContent = '正在切换并准备视频…';
          setLoadingProgress(null);
          window.codexSkinCommand(JSON.stringify({ action: 'select', id: source.value }));
        });
        sourceRow.append(sourceLabel, source); panel.appendChild(sourceRow);
      }
      playbackStatus = document.createElement('div');
      playbackStatus.textContent = cfg.mode === 'video-blob' ? '等待加载原视频…' : (cfg.mode === 'video' ? '原视频播放中 · 离开 Codex 自动暂停' : '预览动画模式 · 离开 Codex 自动暂停');
      playbackStatus.style.cssText = 'margin:6px 0 10px;color:#aeb7c6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      panel.appendChild(playbackStatus);
      playbackProgressTrack = document.createElement('div');
      playbackProgressTrack.setAttribute('role', 'progressbar');
      playbackProgressTrack.setAttribute('aria-label', '视频加载进度');
      playbackProgressTrack.style.cssText = 'height:5px;margin:-4px 0 11px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.12)';
      playbackProgressFill = document.createElement('div');
      playbackProgressFill.style.cssText = 'height:100%;width:0;border-radius:inherit;background:#4aa3ff;transition:width .16s ease';
      playbackProgressTrack.appendChild(playbackProgressFill);
      panel.appendChild(playbackProgressTrack);
      if (cfg.mode === 'video-blob') setLoadingProgress(0); else playbackProgressTrack.style.display = 'none';
      const addRange = (label, min, max, step, value, onInput) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:grid;grid-template-columns:76px 1fr 38px;align-items:center;gap:7px;margin:7px 0';
        const name = document.createElement('span'); name.textContent = label;
        const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
        const output = document.createElement('span'); output.textContent = value; output.style.textAlign = 'right';
        input.addEventListener('input', () => { output.textContent = input.value; onInput(Number(input.value)); });
        row.append(name, input, output); panel.appendChild(row);
      };
      const fitRow = document.createElement('label');
      fitRow.style.cssText = 'display:grid;grid-template-columns:76px 1fr;align-items:center;gap:7px;margin:7px 0';
      const fitLabel = document.createElement('span'); fitLabel.textContent = '适配';
      const fit = document.createElement('select');
      fit.style.cssText = 'background:#24272d;color:#fff;border:1px solid #4a4f58;border-radius:6px;padding:4px';
      [['cover','铺满裁切'],['contain','完整显示'],['fill','拉伸铺满']].forEach(([value,text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === cfg.fitMode; fit.appendChild(option); });
      fit.addEventListener('change', () => { media.style.objectFit = fit.value; });
      fitRow.append(fitLabel, fit); panel.appendChild(fitRow);
      addRange('缩放 %', 50, 200, 1, cfg.zoom, value => { media.style.transform = 'scale(' + (value / 100) + ')'; });
      let x = cfg.positionX, y = cfg.positionY;
      const applyPosition = () => { media.style.objectPosition = x + '% ' + y + '%'; };
      addRange('水平位置', 0, 100, 1, x, value => { x = value; applyPosition(); });
      addRange('垂直位置', 0, 100, 1, y, value => { y = value; applyPosition(); });
      addRange('面板透明', 10, 100, 1, Math.round(cfg.panelOpacity * 100), value => rootStyle.setProperty('--codex-skin-panel-opacity', value / 100));
      addRange('背景遮罩', 0, 80, 1, Math.round(cfg.scrimOpacity * 100), value => { scrim.style.background = 'rgba(0,0,0,' + (value / 100) + ')'; });
      addRange('背景模糊', 0, 40, 1, cfg.blurPx, value => rootStyle.setProperty('--codex-skin-blur', value + 'px'));
      toggle.addEventListener('click', () => {
        window.__codexWallpaperControlsOpen = panel.style.display === 'none';
        panel.style.display = window.__codexWallpaperControlsOpen ? 'block' : 'none';
      });
      controls.append(toggle, panel);
      document.body.appendChild(controls);
    }
    syncPlayback();
    return { installed: true, mode: cfg.mode, url: location.href, controls: !!document.getElementById(id + '-controls') };
  })()`;
}

const REMOVE_SCRIPT = `(() => {
  const id = ${JSON.stringify(LAYER_ID)};
  document.getElementById(id)?.remove();
  document.getElementById(id + '-style')?.remove();
  document.getElementById(id + '-controls')?.remove();
  window.__codexWallpaperPauseCleanup?.();
  window.__codexWallpaperPauseCleanup = null;
  window.__codexWallpaperSyncPlayback = null;
  document.documentElement.style.removeProperty('--codex-skin-panel-opacity');
  document.documentElement.style.removeProperty('--codex-skin-blur');
  if (window.__codexWallpaperFrameTimer) cancelAnimationFrame(window.__codexWallpaperFrameTimer);
  window.__codexWallpaperFrameTimer = null;
  window.__codexWallpaperFrameCache = null;
  if (window.__codexWallpaperBlobUrl) URL.revokeObjectURL(window.__codexWallpaperBlobUrl);
  window.__codexWallpaperBlobUrl = null;
  window.__codexWallpaperVideoChunks = null;
  return { removed: true, url: location.href };
})()`;

async function discoverTargets(port = DEFAULT_CDP_PORT) {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Codex debug endpoint returned HTTP ${response.status}.`);
  const targets = await response.json();
  return targets.filter(isCodexTarget);
}

export function isCodexTarget(target) {
  return target?.type === 'page'
    && Boolean(target.webSocketDebuggerUrl)
    && target.url === 'app://-/index.html';
}

export function buildNativeThemeString({ variant = 'dark', accent = '#339CFF', surface = '#181818', ink = '#FFFFFF', contrast = 60, codeThemeId = 'codex', uiFont = null, codeFont = null, translucent = true }) {
  const hex = /^#[0-9A-Fa-f]{6}$/;
  for (const [name, value] of Object.entries({ accent, surface, ink })) {
    if (!hex.test(value)) throw new Error(`${name} must be a six-digit hex color.`);
  }
  if (!['light', 'dark'].includes(variant)) throw new Error('variant must be light or dark.');
  const payload = {
    codeThemeId,
    theme: {
      accent,
      contrast: Math.max(0, Math.min(100, Math.round(contrast))),
      fonts: { code: codeFont || null, ui: uiFont || null },
      ink,
      opaqueWindows: !translucent,
      semanticColors: { diffAdded: '#40C977', diffRemoved: '#FA423E', skill: '#AD7BF9' },
      surface,
    },
    variant,
  };
  return `codex-theme-v1:${JSON.stringify(payload)}`;
}

export class CodexSkinBridge {
  constructor({ cdpPort = DEFAULT_CDP_PORT } = {}) {
    this.cdpPort = cdpPort;
    this.clients = new Map();
    this.active = null;
    this.watchdog = null;
    this.streamGeneration = 0;
    this.selectionTask = Promise.resolve();
  }

  async debugStatus() {
    try {
      const targets = await discoverTargets(this.cdpPort);
      return { available: targets.length > 0, port: this.cdpPort, targetCount: targets.length };
    } catch (error) {
      return { available: false, port: this.cdpPort, targetCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async ensureClients() {
    const targets = await discoverTargets(this.cdpPort);
    const added = [];
    for (const target of targets) {
      if (this.clients.has(target.id)) continue;
      const client = new CdpClient(target.webSocketDebuggerUrl);
      await client.connect();
      await client.call('Page.enable');
      await client.call('Runtime.enable');
      await client.call('Runtime.addBinding', { name: 'codexSkinCommand' });
      await client.call('Page.setBypassCSP', { enabled: true });
      client.onEvent = (message) => this.handleClientEvent(message);
      this.clients.set(target.id, client);
      added.push(client);
    }
    return { targetCount: targets.length, added };
  }

  handleClientEvent(message) {
    if (message.method !== 'Runtime.bindingCalled' || message.params?.name !== 'codexSkinCommand') return;
    let command;
    try { command = JSON.parse(message.params.payload); } catch { return; }
    if (command?.action !== 'select' || typeof command.id !== 'string') return;
    const previous = this.active;
    const settings = previous ? {
      panelOpacity: previous.panelOpacity, scrimOpacity: previous.scrimOpacity,
      blurPx: previous.blurPx, muted: previous.muted, fitMode: previous.fitMode,
      zoom: previous.zoom, positionX: previous.positionX, positionY: previous.positionY,
      showControls: previous.showControls,
    } : {};
    this.selectionTask = this.selectionTask
      .catch(() => {})
      .then(() => this.apply({ id: command.id, ...settings }))
      .catch((error) => this.reportVideoError(error));
  }

  async reportVideoError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const expression = `window.__codexWallpaperVideoError?.(${JSON.stringify(message)})`;
    for (const client of this.clients.values()) {
      try { await client.call('Runtime.evaluate', { expression }); } catch { /* closed target */ }
    }
  }

  async streamVideoToClients(file, totalBytes, generation) {
    const token = `${generation}-${Date.now()}`;
    const begin = `window.__codexWallpaperBeginVideo?.(${JSON.stringify(token)},${totalBytes})`;
    for (const client of this.clients.values()) await client.call('Runtime.evaluate', { expression: begin });
    const descriptor = openSync(file, 'r');
    const buffer = Buffer.allocUnsafe(2 * 1024 * 1024);
    try {
      let offset = 0;
      while (offset < totalBytes) {
        if (generation !== this.streamGeneration) return;
        const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, totalBytes - offset), offset);
        if (!count) throw new Error('Unexpected end of video file.');
        const base64 = buffer.subarray(0, count).toString('base64');
        const push = `window.__codexWallpaperPushVideoChunk?.(${JSON.stringify(token)},${JSON.stringify(base64)})`;
        for (const client of this.clients.values()) await client.call('Runtime.evaluate', { expression: push });
        offset += count;
      }
    } finally {
      closeSync(descriptor);
    }
    if (generation !== this.streamGeneration) return;
    const finish = `window.__codexWallpaperFinishVideo?.(${JSON.stringify(token)},${JSON.stringify(mimeFor(file))})`;
    for (const client of this.clients.values()) await client.call('Runtime.evaluate', { expression: finish });
  }

  async injectCurrent({ onlyNew = false } = {}) {
    const { targetCount, added } = await this.ensureClients();
    if (!targetCount) throw new Error('No Codex renderer targets were found on the debug port.');
    const source = makeInjectionScript(this.active);
    const results = [];
    const clients = onlyNew ? added : this.clients.values();
    for (const client of clients) {
      if (client.scriptId) {
        try { await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId }); } catch { /* ignore */ }
      }
      const registered = await client.call('Page.addScriptToEvaluateOnNewDocument', { source });
      client.scriptId = registered.identifier;
      const evaluated = await client.call('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
      results.push(evaluated.result?.value || { installed: true });
    }
    return results;
  }

  async apply({ id, panelOpacity, scrimOpacity, blurPx, muted, fitMode, zoom, positionX, positionY, showControls }) {
    const projects = enumerateWallpaperSources();
    const project = projects.find((item) => item.id === id);
    if (!project) throw new Error(`Unknown Wallpaper Engine source id: ${id}`);
    if (project.skinMode === 'unsupported') throw new Error('This project has no browser-portable media or preview image.');
    const selected = selectEmbeddableMedia(project);
    this.active = {
      mediaUrl: selected.mediaUrl,
      mediaFrames: selected.mediaFrames || [],
      frameDelayMs: selected.frameDelayMs || 250,
      frameRate: selected.frameRate || null,
      mode: selected.mode,
      panelOpacity: Number.isFinite(panelOpacity) ? Math.max(0.2, Math.min(1, panelOpacity)) : 0.68,
      scrimOpacity: Number.isFinite(scrimOpacity) ? Math.max(0, Math.min(0.9, scrimOpacity)) : 0.22,
      blurPx: Number.isFinite(blurPx) ? Math.max(0, Math.min(60, Math.round(blurPx))) : 16,
      muted: muted !== false,
      fitMode: ['cover', 'contain', 'fill'].includes(fitMode) ? fitMode : 'cover',
      zoom: Number.isFinite(zoom) ? Math.max(50, Math.min(200, Math.round(zoom))) : 100,
      positionX: Number.isFinite(positionX) ? Math.max(0, Math.min(100, Math.round(positionX))) : 50,
      positionY: Number.isFinite(positionY) ? Math.max(0, Math.min(100, Math.round(positionY))) : 50,
      showControls: showControls !== false,
      sourceOptions: projects
        .filter((item) => item.type === 'video' && item.skinMode !== 'unsupported')
        .map((item) => ({ id: item.id, title: item.title })),
      currentId: project.id,
    };
    const generation = ++this.streamGeneration;
    const targets = await this.injectCurrent();
    if (selected.mode === 'video-blob') {
      this.streamVideoToClients(selected.videoPath, selected.videoBytes, generation)
        .catch((error) => this.reportVideoError(error));
    }
    if (!this.watchdog) {
      this.watchdog = setInterval(() => {
        if (this.active) this.injectCurrent({ onlyNew: true }).catch(() => {});
      }, 5000);
      this.watchdog.unref();
    }
    return {
      applied: true,
      project: { id: project.id, title: project.title, type: project.type, skinMode: project.skinMode },
      renderMode: selected.mode,
      usedPreviewFallback: selected.fallback,
      fallbackKind: selected.fallbackKind,
      sourceResolution: selected.sourceResolution || null,
      renderResolution: selected.renderResolution || null,
      frameRate: selected.frameRate || null,
      videoLoading: selected.mode === 'video-blob',
      videoBytes: selected.videoBytes || null,
      compressed: selected.compressed || false,
      originalBytes: selected.originalBytes || null,
      compressionRatio: selected.compressionRatio || null,
      bitrateKbps: selected.bitrateKbps || null,
      compressionCached: selected.compressionCached || false,
      targetCount: targets.length,
      settings: {
        panelOpacity: this.active.panelOpacity, scrimOpacity: this.active.scrimOpacity,
        blurPx: this.active.blurPx, muted: this.active.muted, fitMode: this.active.fitMode,
        zoom: this.active.zoom, positionX: this.active.positionX, positionY: this.active.positionY,
        showControls: this.active.showControls,
      },
    };
  }

  async remove() {
    this.streamGeneration++;
    const removed = [];
    try { await this.ensureClients(); } catch { /* debug endpoint may already be gone */ }
    for (const client of this.clients.values()) {
      try {
        if (client.scriptId) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
        const evaluated = await client.call('Runtime.evaluate', { expression: REMOVE_SCRIPT, returnByValue: true });
        removed.push(evaluated.result?.value || { removed: true });
      } catch { /* closed target */ }
      client.close();
    }
    this.clients.clear();
    this.active = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    return { removed: true, targetCount: removed.length };
  }

  async status() {
    const active = this.active ? {
      mode: this.active.mode,
      panelOpacity: this.active.panelOpacity,
      scrimOpacity: this.active.scrimOpacity,
      blurPx: this.active.blurPx,
      muted: this.active.muted,
      fitMode: this.active.fitMode,
      zoom: this.active.zoom,
      positionX: this.active.positionX,
      positionY: this.active.positionY,
      showControls: this.active.showControls,
    } : null;
    return { debug: await this.debugStatus(), active, connectedTargets: this.clients.size };
  }
}
