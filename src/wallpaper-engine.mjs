import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const WE_APP_ID = '431960';

const COMMON_STEAM_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\SteamLibrary',
];

function uniqueExistingDirectories(paths) {
  const seen = new Set();
  return paths
    .filter(Boolean)
    .map((value) => normalize(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key) || !existsSync(value)) return false;
      seen.add(key);
      try { return statSync(value).isDirectory(); } catch { return false; }
    });
}

export function steamPathFromRegistry() {
  if (process.platform !== 'win32') return null;
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const output = execFileSync(
      reg,
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(output);
    return match ? normalize(match[1].trim()) : null;
  } catch {
    return null;
  }
}

export function librariesFromVdfText(text) {
  const libraries = [];
  let currentPath = null;
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
    if (match) currentPath = match[1].replace(/\\\\/g, '\\');
    if (currentPath && new RegExp(`"${WE_APP_ID}"\\s+"1"`).test(line)) {
      libraries.push(normalize(currentPath));
      currentPath = null;
    }
  }
  return [...new Set(libraries)];
}

function steamRoots() {
  const override = process.env.WALLPAPER_ENGINE_STEAM_ROOT;
  return uniqueExistingDirectories([
    override,
    steamPathFromRegistry(),
    ...COMMON_STEAM_DIRS,
  ]);
}

export function wallpaperEngineSourceInfo() {
  const roots = steamRoots();
  const libraries = [];
  for (const root of roots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) {
      try { libraries.push(...librariesFromVdfText(readFileSync(vdf, 'utf8'))); } catch { /* malformed VDF */ }
    }
    if (existsSync(join(root, 'steamapps', 'common', 'wallpaper_engine'))) libraries.push(root);
  }

  const candidates = [
    process.env.WALLPAPER_ENGINE_HOME,
    ...[...roots, ...libraries].map((root) => join(root, 'steamapps', 'common', 'wallpaper_engine')),
    'C:\\Program Files (x86)\\Wallpaper Engine',
  ].filter(Boolean);

  let installDir = null;
  for (const candidate of candidates) {
    const dir = normalize(candidate);
    if (existsSync(join(dir, 'wallpaper64.exe')) || existsSync(join(dir, 'wallpaper32.exe'))) {
      installDir = dir;
      break;
    }
  }

  return {
    installed: Boolean(installDir),
    installDir,
    steamRoots: roots,
    libraryDirs: uniqueExistingDirectories([...roots, ...libraries]),
  };
}

function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
  if (/\.html?$/i.test(file)) return 'web';
  if (/\.exe$/i.test(file)) return 'application';
  return 'scene';
}

export function readProject(projectDir, source = 'local') {
  const projectPath = join(projectDir, 'project.json');
  if (!existsSync(projectPath)) return null;
  try {
    const data = JSON.parse(readFileSync(projectPath, 'utf8'));
    if (!data || typeof data !== 'object' || typeof data.file !== 'string') return null;
    const folderId = basename(projectDir);
    const type = typeof data.type === 'string' ? data.type.toLowerCase() : inferType(data.file);
    const previewCandidate = typeof data.preview === 'string' ? resolve(projectDir, data.preview) : null;
    const previewPath = previewCandidate && existsSync(previewCandidate) ? previewCandidate : null;
    const filePath = resolve(projectDir, data.file);
    const portableMediaExists = existsSync(filePath);
    return {
      id: source === 'workshop' ? folderId : `${source}:${folderId}`,
      source,
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : folderId,
      type: ['scene', 'video', 'web', 'application'].includes(type) ? type : 'scene',
      projectPath,
      projectDir,
      filePath,
      previewPath,
      skinMode: type === 'video' && portableMediaExists
        ? 'video'
        : type === 'web' && portableMediaExists
          ? 'web'
          : previewPath
            ? 'preview'
            : 'unsupported',
    };
  } catch {
    return null;
  }
}

export function enumerateWallpaperSources(info = wallpaperEngineSourceInfo()) {
  const roots = [];
  if (info.installDir) {
    roots.push({ path: join(info.installDir, 'projects', 'defaultprojects'), source: 'default' });
    roots.push({ path: join(info.installDir, 'projects', 'myprojects'), source: 'local' });
  }
  for (const library of info.libraryDirs || []) {
    roots.push({ path: join(library, 'steamapps', 'workshop', 'content', WE_APP_ID), source: 'workshop' });
  }

  const found = new Map();
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    let entries;
    try { entries = readdirSync(root.path); } catch { continue; }
    for (const entry of entries) {
      const projectDir = join(root.path, entry);
      let stat;
      try { stat = statSync(projectDir); } catch { continue; }
      if (!stat.isDirectory()) continue;
      const project = readProject(projectDir, root.source);
      if (!project) continue;
      const key = normalize(project.projectPath).toLowerCase();
      if (!found.has(key)) found.set(key, project);
    }
  }
  return [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function wallpaperSourceStatus() {
  const info = wallpaperEngineSourceInfo();
  const sources = info.installed ? enumerateWallpaperSources(info) : [];
  return {
    platform: process.platform,
    installed: info.installed,
    installDir: info.installDir,
    sourceCount: sources.length,
    usableAsCodexSkin: sources.filter((item) => item.skinMode !== 'unsupported').length,
    countsByMode: Object.fromEntries(
      ['video', 'web', 'preview', 'unsupported'].map((mode) => [mode, sources.filter((item) => item.skinMode === mode).length]),
    ),
  };
}
