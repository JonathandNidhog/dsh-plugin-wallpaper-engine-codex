# dsh-plugin-wallpaper-engine-codex

由 Codex 维护的 DSH Wallpaper Engine 插件。它会扫描本机 Steam 库，通过同源路由提供可移植的壁纸媒体，并把选中的 Video/Web 壁纸渲染到 DSH 网页界面后方。

支持视频壁纸、Web 壁纸、缩略图、Steam 创意工坊扫描、暂停/播放、液态玻璃效果调节和客户端轮播。Scene 与 Application 壁纸依赖 Wallpaper Engine 原生渲染器或外部窗口，浏览器无法安全嵌入，因此不会作为实时背景提供。

## 安装

```bash
dsh plugin --profile web add github:JonathandNidhog/dsh-plugin-wallpaper-engine-codex
```

重启 `dsh web`，然后在设置中打开 Wallpaper Engine。开发时运行 `npm install && npm run verify`，再用 `link:<绝对路径>` 安装本地目录。

插件会读取 Steam 的 `libraryfolders.vdf` 并探测常见安装目录；如果需要，也可以设置 `DSH_WE_STEAM_ROOT` 指定 Steam 根目录。

## 许可

本项目采用 MIT 许可。Wallpaper Engine 壁纸内容的版权归原作者所有，请仅使用你有权访问和展示的媒体。
