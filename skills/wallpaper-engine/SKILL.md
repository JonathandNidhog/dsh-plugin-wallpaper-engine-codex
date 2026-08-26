---
name: wallpaper-engine
description: Use installed Wallpaper Engine projects as a reversible background skin inside the Codex app. Use when the user asks to skin, theme, decorate, or set a Wallpaper Engine background in Codex, list compatible local projects, remove the Codex skin, or generate a native Codex color theme.
---

# Wallpaper Engine Skin for Codex

Use the plugin's `codex_skin` MCP tools. This plugin changes the Codex window, never the Windows desktop wallpaper.

## Workflow

1. Call `codex_skin_status` first.
2. If `bridge.debug.available` is false, call `codex_skin_launch_instructions`. Explain that the user must close Codex and relaunch it with the bundled script, then continue in a new task.
3. Call `codex_skin_list_sources` before applying a skin. Resolve the request to an exact returned `id`; ask the user only if multiple plausible matches remain.
4. Call `codex_skin_apply` with that exact id. Keep video muted unless the user explicitly asks for sound.
5. Call `codex_skin_remove` when the user wants the normal Codex appearance restored.
6. Use `codex_skin_generate_native_theme` when the user wants a supported color/font theme or cannot use the dynamic bridge.

## Rendering expectations

- Small video files render inline. Videos over the compression threshold are automatically transcoded into a full-duration, hardware-friendly cached MP4 before Blob playback. Files still over the Blob limit use a decoded animation sequence, with the project preview as the final fallback.
- Web, Scene, and Application projects use their preview image because their local files cannot be loaded safely from Codex's `app://` renderer.
- The dynamic skin is experimental because Codex does not expose a public background-image plugin API. The launcher enables a loopback-only Chrome DevTools endpoint and does not modify installed Codex files.
- The skin remains active while the plugin MCP process and Codex debug target remain available. A Codex restart requires reapplying it.
- Report `renderMode`, `fallbackKind`, and `usedPreviewFallback` honestly after apply. Describe `frames` as a decoded animation sequence, not direct video playback.
- Keep `showControls` enabled by default. Tell the user that “皮肤调整” selects a local video and controls fit mode, zoom, position, panel opacity, background scrim, and blur.
- The controls panel stays open across a video switch. It shows indeterminate progress while preparing/transcoding, measured 0–100% progress while transferring, green on completion, and red on failure.
- Video and frame playback pause automatically while the Codex window is unfocused, minimized, or hidden, and resume when it becomes active.
- Transcoding writes only to the plugin cache under local application data and never changes a Wallpaper Engine source project. Report compression size and resolution when available.

## Safety

- Listing and status calls are read-only.
- Apply and remove affect only the current Codex renderer and are reversible.
- Never call Wallpaper Engine playback or desktop-control commands.
- Never delete or modify Wallpaper Engine projects.
- Never accept an arbitrary filesystem path for injection; apply only ids returned by `codex_skin_list_sources`.
- Connect only to CDP targets whose URL is exactly `app://-/index.html`. Never inspect or inject WebViews, browser tabs, HTTPS pages, login pages, or any non-Codex target.
