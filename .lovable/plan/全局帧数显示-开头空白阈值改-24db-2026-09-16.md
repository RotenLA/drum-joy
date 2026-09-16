# 全局帧数显示 + 开头空白阈值改 -24dB

## 现状（已确认）

- `src/taiko/stems.ts` 中 `SILENCE_THRESHOLD = 10 ** (-50 / 20)`，李白这类开头有轻微底噪的歌会被误判为「有声」，切不干净。
- 目前没有任何帧率显示。

## 要做的事

1. 开头空白阈值改 -24dB
   - `SILENCE_THRESHOLD` 改为 `10 ** (-24 / 20)`。
   - 效果：开头低于 -24dB 的轻微内容（底噪、气息、很轻的引子）都视为空白被切掉；依旧保留 30ms 音头余量，四轨与 MIDI 同步平移的逻辑不变。
   - 若某轨整轨都低于阈值，返回整轨时长，`stemsLeadMs` 取四轨最小值兜住，不会误切。

2. 全局左上角帧数显示
   - 新增轻量 FPS 小组件：每秒刷新一次，显示「xx FPS」。
   - 用 requestAnimationFrame 计数，不渲染时开销可忽略；挂在 TaikoShell 最外层，谱面/映射/位置捕捉/游玩四屏都显示。
   - 样式：半透明小字徽章，固定在 taiko-root 左上角（预留安全区距离），不挡左侧导航按钮，指针事件穿透（点不到、不挡操作）。

## 技术细节

- `src/taiko/stems.ts`：改一行常量。
- 新增 `src/taiko/FpsBadge.tsx`：rAF 循环计数 + 1s 定时 setState；`pointer-events-none`，`position:absolute` 于 taiko-root 左上（top/left 用 safe inset）。
- `src/taiko/TaikoShell.tsx`：最外层容器加 `relative`，挂载 `<FpsBadge />`。

## 交付

改动打包成 zip 放到 /mnt/documents/，附文件清单；本地解压后按 bun install / electron:rebuild:asio / electron:pack:win 三步走。
