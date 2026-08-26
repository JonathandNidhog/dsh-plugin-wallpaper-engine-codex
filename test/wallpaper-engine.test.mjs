import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildNativeThemeString, clearSavedSkinState, CodexSkinBridge, isCodexTarget, isPathInside, makeInjectionScript, readSavedSkinState, selectEmbeddableMedia, writeSavedSkinState } from '../src/codex-skin.mjs';
import { enumerateWallpaperSources, librariesFromVdfText, readProject } from '../src/wallpaper-engine.mjs';

test('parses the Steam library that owns Wallpaper Engine', () => {
  const vdf = `
"libraryfolders"
{
  "0"
  {
    "path" "C:\\\\Program Files (x86)\\\\Steam"
    "apps" { "431960" "1" }
  }
  "1"
  {
    "path" "D:\\\\SteamLibrary"
    "apps" { "999" "1" }
  }
}`;
  assert.deepEqual(librariesFromVdfText(vdf), ['C:\\Program Files (x86)\\Steam']);
});

test('classifies video and scene preview projects for Codex rendering', () => {
  const root = mkdtempSync(join(tmpdir(), 'we-codex-'));
  const installDir = join(root, 'wallpaper_engine');
  const videoDir = join(installDir, 'projects', 'myprojects', 'aurora');
  const sceneDir = join(root, 'steamapps', 'workshop', 'content', '431960', '123456');
  mkdirSync(videoDir, { recursive: true });
  mkdirSync(sceneDir, { recursive: true });
  writeFileSync(join(videoDir, 'aurora.mp4'), 'video');
  writeFileSync(join(sceneDir, 'preview.jpg'), 'preview');
  writeFileSync(join(videoDir, 'project.json'), JSON.stringify({ title: 'Aurora', type: 'video', file: 'aurora.mp4' }));
  writeFileSync(join(sceneDir, 'project.json'), JSON.stringify({ title: 'City', type: 'scene', file: 'scene.pkg', preview: 'preview.jpg' }));

  assert.equal(readProject(videoDir, 'local').skinMode, 'video');
  assert.equal(readProject(sceneDir, 'workshop').skinMode, 'preview');
  const projects = enumerateWallpaperSources({ installDir, libraryDirs: [root] });
  assert.deepEqual(projects.map((item) => [item.id, item.skinMode]).sort(), [['123456', 'preview'], ['local:aurora', 'video']]);
});

test('builds a native Codex theme import string', () => {
  const value = buildNativeThemeString({ accent: '#112233', surface: '#181818', ink: '#FFFFFF' });
  assert.match(value, /^codex-theme-v1:/);
  const payload = JSON.parse(value.slice('codex-theme-v1:'.length));
  assert.equal(payload.theme.accent, '#112233');
  assert.equal(payload.theme.opaqueWindows, false);
});

test('builds an injection script without embedding filesystem paths', () => {
  const script = makeInjectionScript({ mediaUrl: 'http://127.0.0.1:4321/content/token/video.mp4', mode: 'video' });
  assert.match(script, /codex-wallpaper-engine-skin/);
  assert.match(script, /皮肤调整/);
  assert.match(script, /bg-surface/);
  assert.match(script, /127\.0\.0\.1:4321/);
  assert.doesNotMatch(script, /[A-Z]:\\\\/);
});

test('builds a timed frame animation', () => {
  const script = makeInjectionScript({
    mediaUrl: 'data:image/jpeg;base64,AA==',
    mediaFrames: ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,AQ=='],
    frameDelayMs: 200,
    mode: 'frames',
  });
  assert.match(script, /__codexWallpaperFrameTimer/);
  assert.match(script, /frameIndex/);
  assert.match(script, /requestAnimationFrame/);
  assert.doesNotMatch(script, /setInterval/);
});

test('builds full-video transfer and video-selection controls', () => {
  const script = makeInjectionScript({
    mediaUrl: 'data:image/gif;base64,R0lGODlh',
    mode: 'video-blob',
    currentId: 'one',
    sourceOptions: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }],
  });
  assert.match(script, /__codexWallpaperPushVideoChunk/);
  assert.match(script, /__codexWallpaperFinishVideo/);
  assert.match(script, /codexSkinCommand/);
  assert.match(script, /正在加载原视频/);
  assert.match(script, /视频加载进度/);
  assert.match(script, /codex-skin-progress-indeterminate/);
  assert.match(script, /aria-valuenow/);
  assert.match(script, /document\.hasFocus/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /已暂停（Codex 未激活）/);
  assert.match(script, /action: 'settings'/);
});

test('allows only the exact Codex main-page CDP target', () => {
  assert.equal(isCodexTarget({ type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://codex' }), true);
  assert.equal(isCodexTarget({ type: 'page', url: 'app://-/index.html?initialRoute=%2Favatar-overlay', webSocketDebuggerUrl: 'ws://overlay' }), false);
  assert.equal(isCodexTarget({ type: 'webview', url: 'https://chatgpt.com/', webSocketDebuggerUrl: 'ws://webview' }), false);
  assert.equal(isCodexTarget({ type: 'page', url: 'https://token.woa.com/', webSocketDebuggerUrl: 'ws://token' }), false);
});

test('launcher confirms before restarting an already-running Codex instance', () => {
  const launcher = readFileSync(new URL('../scripts/launch-codex-with-skin.ps1', import.meta.url), 'utf8');
  const installer = readFileSync(new URL('../install.ps1', import.meta.url), 'utf8');
  assert.match(launcher, /MessageBoxButton\]::YesNo/);
  assert.match(launcher, /Stop-Process -Id/);
  assert.match(launcher, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(installer, /-WindowStyle Hidden/);
});

test('rejects paths outside the selected project directory', () => {
  const root = resolve('project-root');
  assert.equal(isPathInside(root, join(root, 'media', 'video.mp4')), true);
  assert.equal(isPathInside(root, resolve(root, '..', 'secret.txt')), false);
});

test('persists and clears the last enabled Codex skin safely', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-skin-state-'));
  const file = join(root, 'state.json');
  const state = { enabled: true, id: '3030258462', fitMode: 'cover', zoom: 100 };
  writeSavedSkinState(state, file);
  assert.deepEqual(readSavedSkinState(file), state);
  clearSavedSkinState(file);
  assert.equal(existsSync(file), false);
  assert.equal(readSavedSkinState(file), null);
});

test('disconnect keeps saved skin while explicit remove clears it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-skin-lifecycle-'));
  const file = join(root, 'state.json');
  const bridge = new CodexSkinBridge({ cdpPort: 1, stateFile: file, restoreIntervalMs: 60_000 });
  bridge.active = {
    currentId: '3030258462', panelOpacity: 0.68, scrimOpacity: 0.22,
    blurPx: 16, muted: true, fitMode: 'cover', zoom: 100,
    positionX: 50, positionY: 50, showControls: true,
  };
  bridge.persistActive();
  bridge.disconnect();
  assert.equal(readSavedSkinState(file)?.id, '3030258462');

  const remover = new CodexSkinBridge({ cdpPort: 1, stateFile: file, restoreIntervalMs: 60_000 });
  await remover.remove();
  remover.disconnect();
  assert.equal(readSavedSkinState(file), null);
});

test('falls back to an inline preview when a video exceeds the safe limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'we-inline-'));
  const video = join(root, 'large.mp4');
  const preview = join(root, 'preview.gif');
  writeFileSync(video, Buffer.alloc(1024 * 1024 + 1));
  writeFileSync(preview, 'GIF89a');
  const previous = process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB;
  const previousExtraction = process.env.CODEX_SKIN_DISABLE_FRAME_EXTRACTION;
  const previousBlob = process.env.CODEX_SKIN_DISABLE_BLOB_VIDEO;
  process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB = '1';
  process.env.CODEX_SKIN_DISABLE_FRAME_EXTRACTION = '1';
  process.env.CODEX_SKIN_DISABLE_BLOB_VIDEO = '1';
  try {
    const selected = selectEmbeddableMedia({ type: 'video', filePath: video, previewPath: preview });
    assert.equal(selected.mode, 'preview');
    assert.equal(selected.fallback, true);
    assert.match(selected.mediaUrl, /^data:image\/gif;base64,/);
  } finally {
    if (previous === undefined) delete process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB;
    else process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB = previous;
    if (previousExtraction === undefined) delete process.env.CODEX_SKIN_DISABLE_FRAME_EXTRACTION;
    else process.env.CODEX_SKIN_DISABLE_FRAME_EXTRACTION = previousExtraction;
    if (previousBlob === undefined) delete process.env.CODEX_SKIN_DISABLE_BLOB_VIDEO;
    else process.env.CODEX_SKIN_DISABLE_BLOB_VIDEO = previousBlob;
  }
});

test('selects blob streaming for a video too large to inline', () => {
  const root = mkdtempSync(join(tmpdir(), 'we-blob-'));
  const video = join(root, 'video.mp4');
  const preview = join(root, 'preview.jpg');
  writeFileSync(video, Buffer.alloc(1024 * 1024 + 1));
  writeFileSync(preview, 'preview');
  const previous = process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB;
  process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB = '1';
  try {
    const selected = selectEmbeddableMedia({ type: 'video', filePath: video, previewPath: preview });
    assert.equal(selected.mode, 'video-blob');
    assert.equal(selected.videoPath, video);
    assert.equal(selected.videoBytes, 1024 * 1024 + 1);
  } finally {
    if (previous === undefined) delete process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB;
    else process.env.CODEX_SKIN_INLINE_VIDEO_MAX_MB = previous;
  }
});
