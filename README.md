# dsh-plugin-wallpaper-engine-codex

Codex-maintained Wallpaper Engine integration for the DSH web GUI. It discovers the local Steam library, exposes portable Wallpaper Engine media over same-origin routes, and renders selected video/web wallpapers behind DSH with a frosted-glass settings UI.

## What it supports

- Video wallpapers (`.mp4`, `.webm`, and related browser media)
- Web wallpapers loaded in an iframe
- Preview thumbnails, HTTP range requests, and Steam Workshop discovery
- Liquid-glass controls, pause/play, blur/scrim/border tuning, and client-side rotation lists
- Graceful no-op when Steam or the DSH web server is unavailable

Scene and Application wallpapers are intentionally not offered as live backgrounds: they require Wallpaper Engine's native renderer or an external window and cannot be safely executed by a browser.

## Install

```bash
dsh plugin --profile web add github:JonathandNidhog/dsh-plugin-wallpaper-engine-codex
```

Restart `dsh web`, open Settings, and choose the Wallpaper Engine entry.

For local development:

```bash
npm install
npm run verify
dsh plugin --profile web add link:$PWD
```

On Windows, use the absolute folder path after `link:`. The host searches Steam's `libraryfolders.vdf`, the Windows registry, and common install locations. Set `DSH_WE_STEAM_ROOT` to override discovery when needed.

## Routes

The host contributes same-origin routes under `/wallpaper-engine`:

| Route | Purpose |
| --- | --- |
| `GET /inventory` | Installed wallpapers and playlist metadata |
| `GET /media/<token>` | Stream video or web entry file |
| `GET /preview/<token>` | Serve a preview image |

The plugin does not expose model tools or prompt text; it only adds a visual web-GUI layer.

## Development

Edit `src/client.js`, then run `npm run build`. `npm run verify` rebuilds/validates the DSH module-loader artifact and runs the host-side scanner tests. Keep user media out of the repository.

This project is MIT licensed. Wallpaper Engine content remains owned by its creators; use only media you have the right to access and display.
