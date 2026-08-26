# Wallpaper Engine Skin for Codex

**English** | [简体中文](README.zh.md)

A Codex plugin that uses compatible media from installed Wallpaper Engine projects as the background of the Codex app itself. It does **not** change the Windows desktop wallpaper and does not require DSH or Cordis.

> **Project lineage:** this Codex edition is developed from the repository's original DSH Wallpaper Engine integration. The runtime has since been rewritten specifically for Codex; the former DSH/Cordis artifacts are retained in Git history, not in the current distribution. See [NOTICE.md](NOTICE.md).

## How it works

The plugin discovers local Steam/Wallpaper Engine projects, safely embeds compatible media, and inserts it behind the Codex UI through a local Chrome DevTools connection. The bundled launcher starts the official installed Codex executable with debugging bound to `127.0.0.1`; no Codex files are patched or replaced.

- Small video files render as looping video when they fit the safe inline-media limit.
- Videos over 48 MB are automatically cached as full-duration MP4 files capped at 2560×1440, 30 FPS, and about 10 Mbps. Cached results are reused; outputs still over 512 MB fall back to a decoded animation sequence. Web, Scene, or Application projects use their preview image.
- CDP access is allowlisted to the exact Codex main-page URL `app://-/index.html`; browser tabs, WebViews, login pages, HTTPS pages, and other debug targets are never inspected or modified.
- The injected “皮肤调整” panel can switch among local video projects and controls fit mode, zoom, position, panel opacity, scrim, and blur.
- Video switching shows an indeterminate preparation bar during transcoding and measured 0–100% progress during transfer; success turns green and failure turns red.
- Video and frame animation pause automatically while Codex is unfocused, minimized, or hidden, then resume when Codex becomes active.
- Transcoded files are stored under `%LOCALAPPDATA%\CodexWallpaperEngineSkin\transcoded`; source Wallpaper Engine projects are never modified.
- The injected layer is reversible with `codex_skin_remove` and must be reapplied after restarting Codex.

Dynamic backgrounds are experimental: Codex's supported Appearance settings cover colors, fonts, contrast, and translucency, but do not currently provide a public background-media extension point. The plugin can also generate a native `codex-theme-v1` color-theme string as a supported fallback.

## Local development and installation

This repository is the plugin root. It requires Node.js 22 or newer and only uses Node.js built-ins, so `npm install` is unnecessary.

Install it through a local Codex marketplace, then start a new Codex task so its skill and MCP tools are loaded. For dynamic skins:

1. Close every Codex window.
2. Run `scripts/launch-codex-with-skin.ps1`.
3. In a new Codex task, ask to list compatible Wallpaper Engine skins and apply one.

The launcher refuses to continue while Codex is already running. To use another loopback debug port, pass `-Port` to the launcher and set `CODEX_SKIN_CDP_PORT` to the same value for the plugin process.

## Example requests

- “Show Wallpaper Engine projects I can use as a Codex skin.”
- “Apply the Neon City background to Codex with more transparency.”
- “Remove the Codex skin.”
- “Generate a dark native Codex theme with a blue accent.”

If source discovery fails, set `WALLPAPER_ENGINE_HOME` to the Wallpaper Engine directory, or set `WALLPAPER_ENGINE_STEAM_ROOT` to the Steam root.

## Development

```powershell
npm run verify
```

The MCP server communicates through JSON-RPC over stdio. Wallpaper Engine projects are read-only; arbitrary media paths are not accepted.

### Repository layout

| Path | Purpose |
| --- | --- |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.mcp.json` | Local MCP server registration |
| `skills/wallpaper-engine/` | Codex skill workflow and safety rules |
| `scripts/mcp-server.mjs` | MCP tool server |
| `scripts/*.ps1` | Codex launcher, video transcoding, and frame fallback |
| `src/` | Wallpaper discovery and Codex skin bridge |
| `test/` | Node test suite |

Legacy DSH bundles, Cordis patches, generated `lib/` artifacts, and embedded type archives are intentionally excluded from the current Codex distribution.

## License

MIT. See [NOTICE.md](NOTICE.md) for project lineage. Wallpaper Engine and installed project content belong to their respective owners.
