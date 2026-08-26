# Wallpaper Engine Codex 动态皮肤插件

[English](README.md) | **简体中文**

这是一个给 **Codex 应用窗口换动态皮肤** 的插件。它从本机已安装的 Wallpaper Engine 项目中读取可兼容的媒体，放到 Codex 界面背后；它不会修改 Windows 桌面壁纸，也不依赖 DSH 或 Cordis。

> **项目沿革：** 当前 Codex 版本基于本仓库最初的 DSH Wallpaper Engine 集成开发，现已针对 Codex 重写运行时。旧 DSH/Cordis 文件仅保留在 Git 历史中，不再进入当前发行包。详见 [NOTICE.md](NOTICE.md)。

## 工作方式

插件会发现本机 Steam/Wallpaper Engine 项目，安全地内嵌兼容媒体，再借助本机 Chrome DevTools 连接把背景层插入 Codex。配套启动脚本只会给官方 Codex 可执行文件添加绑定到 `127.0.0.1` 的调试参数，不会修改或替换 Codex 安装文件。

- 体积较小的 Video 项目可以直接作为循环视频背景。
- 超过 48 MB 的视频会在首次使用时自动生成最高 2560×1440、30 FPS、约 10 Mbps 的轻量 MP4 缓存，保留完整时长；后续直接复用缓存。压缩后仍超过 512 MB 才回退为约 15 FPS 的帧动画。Web、Scene、Application 项目使用预览图。
- CDP 只允许连接 URL 完全等于 `app://-/index.html` 的 Codex 主页面；浏览器标签、WebView、登录页、HTTPS 页面及其他调试目标均不会被检查或修改。
- 右下角“皮肤调整”面板可从本地视频列表切换皮肤，并实时调整铺满/完整显示、缩放、位置、面板透明度、遮罩和模糊。
- 切换视频时，面板会在转码准备阶段显示动态加载条，在视频传输阶段显示 0–100% 的实际进度；完成变绿，失败变红。
- Codex 窗口失去焦点、最小化或页面隐藏时会自动暂停视频与帧动画；回到 Codex 后自动继续，减少后台 CPU/GPU 占用。
- 压缩缓存保存在 `%LOCALAPPDATA%\CodexWallpaperEngineSkin\transcoded`，不会修改 Wallpaper Engine 原项目。
- 当前皮肤、视频选择和调整参数会保存在 `%LOCALAPPDATA%\CodexWallpaperEngineSkin\state.json`。结束任务不会再移除皮肤；使用配套启动脚本重启 Codex 后会自动恢复。只有明确调用 `codex_skin_remove` 才会同时移除皮肤并清除保存状态。

动态背景属于实验功能：Codex 官方 Appearance 设置支持颜色、字体、对比度和透明效果，但目前没有公开的背景图片/视频插件接口。插件同时提供原生 `codex-theme-v1` 配色主题生成功能作为稳定回退。

## 快速安装与使用

仓库根目录就是 Codex 插件根目录。需要 Node.js 22 或更高版本；实现只用 Node.js 内置模块，无需执行 `npm install`。

在 PowerShell 中粘贴下面这一行：

```powershell
$p = Join-Path $env:TEMP 'install-codex-wallpaper-skin.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/JonathandNidhog/dsh-plugin-wallpaper-engine-codex/main/install.ps1' -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

安装器会自动下载或更新仓库、注册 Codex 个人 marketplace、安装插件，并在桌面和开始菜单创建 `Codex Wallpaper Skin` 快捷方式。以后再次运行同一条命令就是升级。

如果点击快捷方式时普通 Codex 已经在运行，启动器会询问是否自动重启并启用皮肤；它不会再闪退或静默失败。选择“否”不会影响当前任务。

安装完成后：

1. 关闭所有 Codex 窗口。
2. 点击桌面或开始菜单里的 `Codex Wallpaper Skin`。
3. 在新建的 Codex 任务里，让插件列出并应用一次皮肤。以后只要仍通过该启动脚本打开 Codex，插件就会自动恢复上次皮肤和调整参数。

Codex 已运行时，启动脚本会拒绝重复启动。直接从普通 Codex 图标启动时没有调试端口，动态皮肤无法注入；这是 Codex 当前没有公开背景图片 API 带来的限制。需要更换端口时，给脚本传入 `-Port`，并把插件进程的 `CODEX_SKIN_CDP_PORT` 设为相同端口。

开发者也可以克隆仓库，通过本地 Codex marketplace 手动安装，再直接运行 `scripts/launch-codex-with-skin.ps1`。

示例：

- “列出可以用作 Codex 皮肤的 Wallpaper Engine 项目。”
- “把 Neon City 应用到 Codex，面板再透明一点。”
- “移除 Codex 皮肤。”
- “生成一套蓝色强调色的 Codex 原生暗色主题。”

如果自动发现失败，可用 `WALLPAPER_ENGINE_HOME` 指向 Wallpaper Engine 目录，或用 `WALLPAPER_ENGINE_STEAM_ROOT` 指向 Steam 根目录。

## 验证

```powershell
npm run verify
```

插件只读 Wallpaper Engine 项目，不接受任意媒体文件路径。

### 工程结构

| 路径 | 用途 |
| --- | --- |
| `.codex-plugin/plugin.json` | Codex 插件清单 |
| `.mcp.json` | 本地 MCP 服务注册 |
| `install.ps1` | 面向普通用户的一键安装与升级脚本 |
| `skills/wallpaper-engine/` | Codex 技能流程与安全规则 |
| `scripts/mcp-server.mjs` | MCP 工具服务 |
| `scripts/*.ps1` | Codex 启动、视频压缩与帧动画回退 |
| `src/` | Wallpaper Engine 项目发现和 Codex 皮肤桥接 |
| `test/` | Node 测试套件 |

旧 DSH 客户端包、Cordis 补丁、生成的 `lib/` 文件和内嵌类型压缩包已从当前 Codex 工程中移除。

## 许可

MIT。项目沿革见 [NOTICE.md](NOTICE.md)。Wallpaper Engine 与已安装项目内容的版权归各自所有者所有。
