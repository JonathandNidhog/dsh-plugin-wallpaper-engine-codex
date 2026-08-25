---
name: wallpaper-engine
description: Manage the DSH Wallpaper Engine integration from Codex. Use when the user asks to install, diagnose, configure, update, or troubleshoot Wallpaper Engine backgrounds in DSH.
---

# Wallpaper Engine for DSH

This Codex skill manages the companion DSH plugin. Codex itself does not render desktop wallpapers; it can install and diagnose the DSH web-GUI integration.

## Install

Install the published companion plugin into DSH's web profile:

```powershell
dsh plugin --profile web add github:JonathandNidhog/dsh-plugin-wallpaper-engine-codex
```

Restart `dsh web`, then open Settings → Wallpaper Engine.

## Diagnose

Check the DSH CLI, the installed companion package, and common Steam paths. On Windows, Wallpaper Engine is Steam app `431960`. If Steam is installed in a custom location, recommend setting `DSH_WE_STEAM_ROOT` to the Steam root or library roots.

The companion plugin supports Video and Web wallpapers. Scene and Application wallpapers are not browser-portable and should be explained as a platform limitation, not treated as an installation failure.

## Update local development copies

For a local source checkout, use a DSH link install:

```powershell
dsh plugin --profile web add link:C:\path\to\dsh-plugin-wallpaper-engine-codex
```

After editing `src/client.js`, run `npm run build` and `npm run verify`, then restart `dsh web`.

## Safety

Do not delete user wallpaper files or Steam Workshop content. Do not upload wallpaper media to GitHub. Only modify DSH plugin configuration when the user explicitly requests it.
