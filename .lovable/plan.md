# 本地谱面导出工具（Windows 桌面程序）

## 目标
做一个双击就能运行的 Windows 程序，离线运行、不用登录，也不上传任何文件：
1. 选择「歌曲文件夹」：命名规则和后台文件夹导入一样，支持 `歌名 - Drums` 和 `歌名_Drums`，识别原曲、Metro、MIDI 和各条分轨。
2. 选择「导出文件夹」。
3. 点「开始」后逐首处理：用 Metro 轨定拍点、用 MIDI 设计谱面，生成四档谱面。每首输出 `歌名.aerogame-chart.json` 和 `歌名.png`（封面取自原曲内嵌封面，没有就不输出）。
4. 界面列出每首歌的进度和结果（成功或失败原因）。全部完成后可以一键打开导出文件夹。

算法和后台完全共用，同一首歌导出的谱面与后台「导出谱面」内容一致，只有导出时间不同。
不做 BPM 置信度判断，也不跳过歌曲，直接以 Metro 轨和 MIDI 的速度为准。

## 界面
单窗口，深色，和后台风格一致：
- 顶部：两个选择按钮，旁边显示已选的路径。程序会记住上次选的两个文件夹。
- 中部：歌曲列表，每行显示歌名、识别到的文件、状态和 BPM。
- 底部：「开始导出」按钮和总进度。

## 交付
- 已打包好的 `AeroGameChartTool-win32-x64.zip`，解压后双击 `AeroGameChartTool.exe` 就能用。
- 同时提供源码压缩包，算法更新后可以在本地重新打包。

## 技术细节
- 新建目录 `tools/chart-tool/`，包含独立的 Vite 入口（`index.html`、`main.tsx`、`vite.config.ts`，其中 `base: './'`），直接引用 `src/taiko/adminFolderImport.ts`、`adminChartBuild.ts`、`metroAnalysis.ts`、`audioMeta.ts`、`beatGrid.ts` 和 `src/shared/chartExport.ts`，保证算法只有一份。
- `electron/chart-tool/main.cjs` 和 `preload.cjs`：主进程通过 IPC 提供四项能力：选文件夹、读取文件夹内的文件列表和字节、写 JSON 或 PNG、打开文件夹。设置 `contextIsolation: true`，`nodeIntegration: false`，并用 electron-store 的 JSON 文件记住上次路径。
- 渲染进程把字节还原成 File，交给现有流程：`groupImportFiles` 分组，解析 Metro 拍点和 MIDI，再用 `buildAllCharts` 生成四档谱面，最后 `buildChartPackage` 按单曲格式输出。封面用 `audioMeta` 提取后，经 canvas 转成 PNG。
- 逐首顺序处理，处理完释放音频，避免内存峰值。
- 用 `@electron/packager --platform=win32 --arch=x64` 在沙箱交叉打包，产物放 `/mnt/documents`。
- 主站、后台和玩家端都不做改动。`package.json` 只新增 devDependencies 和 `tool:build` / `tool:pack:win` 两个脚本。
- 在 AGENTS.md 记一条：本地工具复用 src/taiko 算法，不另写一份。
