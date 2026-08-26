# Project lineage and acknowledgements

This repository began as a Wallpaper Engine integration for DSH (DeepSeek Harness) and was subsequently rewritten as a native Codex plugin.

The original DSH-oriented implementation is preserved in the Git history, beginning with commit [`ed0ec55`](https://github.com/JonathandNidhog/dsh-plugin-wallpaper-engine-codex/commit/ed0ec55a4095c4dfe1dfa295ffe4aca4ae00328d). The current version retains the project-discovery concept while replacing the DSH/Cordis runtime, client bundle, routes, and UI integration with:

- a Codex plugin manifest and skill;
- a local MCP server;
- a Codex-only, allowlisted CDP bridge;
- automatic video compression and cache reuse;
- in-Codex skin controls, video selection, loading progress, and inactive-window pausing.

DSH, Codex, Steam, Wallpaper Engine, and Wallpaper Engine project content are trademarks or works of their respective owners. This project does not include third-party wallpaper media and does not modify Wallpaper Engine source projects.
