#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  buildNativeThemeString,
  CodexSkinBridge,
} from '../src/codex-skin.mjs';
import {
  enumerateWallpaperSources,
  wallpaperSourceStatus,
} from '../src/wallpaper-engine.mjs';

const bridge = new CodexSkinBridge();
const launcherPath = fileURLToPath(new URL('./launch-codex-with-skin.ps1', import.meta.url));

const tools = [
  {
    name: 'codex_skin_status',
    description: 'Check Codex skin readiness, persistence/auto-restore state, the local debug bridge, and available Wallpaper Engine source media. This does not change the desktop wallpaper.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'codex_skin_list_sources',
    description: 'List Wallpaper Engine projects that can be used as Codex window skin backgrounds. Large videos are automatically transcoded to a lighter cached MP4 before playback; other native types use previews.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive title or id filter.' },
        mode: { type: 'string', enum: ['video', 'web', 'preview'], description: 'Optional Codex skin rendering mode.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'codex_skin_apply',
    description: 'Embed a selected Wallpaper Engine source or its safe preview behind the Codex app UI. Requires the local debug port and never changes the Windows desktop wallpaper.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Exact id returned by codex_skin_list_sources.' },
        panelOpacity: { type: 'number', minimum: 0.2, maximum: 1, default: 0.68 },
        scrimOpacity: { type: 'number', minimum: 0, maximum: 0.9, default: 0.22 },
        blurPx: { type: 'number', minimum: 0, maximum: 60, default: 16 },
        muted: { type: 'boolean', default: true, description: 'Mute video wallpaper audio.' },
        fitMode: { type: 'string', enum: ['cover', 'contain', 'fill'], default: 'cover', description: 'How the media fits the Codex window.' },
        zoom: { type: 'number', minimum: 50, maximum: 200, default: 100 },
        positionX: { type: 'number', minimum: 0, maximum: 100, default: 50 },
        positionY: { type: 'number', minimum: 0, maximum: 100, default: 50 },
        showControls: { type: 'boolean', default: true, description: 'Show an in-app skin adjustment panel.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'codex_skin_remove',
    description: 'Remove the injected Codex background layer and restore normal Codex rendering.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'codex_skin_launch_instructions',
    description: 'Return the bundled Windows launcher path and steps required to start Codex with the reversible local skin bridge enabled.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'codex_skin_generate_native_theme',
    description: 'Generate an official Codex codex-theme-v1 import string for colors and fonts. This is the supported fallback when dynamic background injection is unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        variant: { type: 'string', enum: ['light', 'dark'], default: 'dark' },
        accent: { type: 'string', default: '#339CFF' },
        surface: { type: 'string', default: '#181818' },
        ink: { type: 'string', default: '#FFFFFF' },
        contrast: { type: 'integer', minimum: 0, maximum: 100, default: 60 },
        codeThemeId: { type: 'string', default: 'codex' },
        uiFont: { type: ['string', 'null'] },
        codeFont: { type: ['string', 'null'] },
        translucent: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
];

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

async function callTool(name, args = {}) {
  if (name === 'codex_skin_status') {
    return { source: wallpaperSourceStatus(), bridge: await bridge.status(), launcherPath };
  }
  if (name === 'codex_skin_list_sources') {
    let sources = enumerateWallpaperSources().filter((item) => item.skinMode !== 'unsupported');
    if (args.mode) sources = sources.filter((item) => item.skinMode === args.mode);
    if (args.query) {
      const query = args.query.toLowerCase();
      sources = sources.filter((item) => `${item.id}\n${item.title}`.toLowerCase().includes(query));
    }
    const limit = Number.isInteger(args.limit) ? Math.min(500, Math.max(1, args.limit)) : 100;
    return {
      totalMatched: sources.length,
      sources: sources.slice(0, limit).map(({ id, title, type, source, skinMode }) => ({ id, title, type, source, skinMode })),
    };
  }
  if (name === 'codex_skin_apply') return bridge.apply(args);
  if (name === 'codex_skin_remove') return bridge.remove();
  if (name === 'codex_skin_launch_instructions') {
    return {
      launcherPath,
      steps: [
        'Close all Codex windows so no ChatGPT.exe root process remains.',
        'Run the bundled PowerShell launcher. It starts the official installed Codex executable with --remote-debugging-port=9222.',
        'Open a new Codex task. The last enabled skin is restored automatically; ask the plugin to list and apply a skin only if none was saved.',
      ],
      persistence: 'The selected skin and adjustment settings are stored under LocalAppData. codex_skin_remove deletes that saved preference.',
      security: 'The launcher does not patch or replace Codex files. The debug endpoint binds to loopback and the injected layer is removable.',
    };
  }
  if (name === 'codex_skin_generate_native_theme') {
    const theme = buildNativeThemeString(args);
    return {
      theme,
      importSteps: 'Open Settings → Appearance, choose Import in the matching Light or Dark theme row, paste the full string, preview, and confirm.',
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (!Object.hasOwn(message, 'id')) return;
  try {
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'codex-wallpaper-skin', version: '0.3.0' } } });
      return;
    }
    if (message.method === 'ping') { send({ jsonrpc: '2.0', id: message.id, result: {} }); return; }
    if (message.method === 'tools/list') { send({ jsonrpc: '2.0', id: message.id, result: { tools } }); return; }
    if (message.method === 'tools/call') {
      try {
        send({ jsonrpc: '2.0', id: message.id, result: textResult(await callTool(message.params?.name, message.params?.arguments || {})) });
      } catch (error) {
        send({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } });
      }
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: String(error) } });
  }
});

async function shutdown() {
  // Disconnect without deleting the saved skin or removing the layer from a
  // Codex window that is still running.
  bridge.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
