# 帧数显示改为监视游玩演奏界面

## 现状（已确认）

- 上一版在 TaikoShell 挂了全局 `FpsBadge`（独立 rAF 计数），测的是浏览器整体刷新率，不是游玩画面的真实渲染帧率。
- `src/taiko/FallScreen.tsx` 的演奏循环每帧已把帧间隔喂给 `perf.ts` 的 `quality.sample(dtMs, now)`，这里有最真实的每帧耗时。
- `src/taiko/perf.ts` 已有三档画质与 `maxFps` 上限逻辑。

## 要做的事

1. 删掉全局徽章
   - 移除 `TaikoShell` 里的 `<FpsBadge />`（谱面/映射/位置捕捉不再显示）。

2. 帧数改在游玩屏采样
   - `FpsBadge` 改为订阅演奏渲染循环的真实帧间隔（在 FallScreen 的渲染循环里顺手记录，不另开 rAF），每秒刷新一次显示「xx FPS」。
   - 徽章定位在游玩演奏区左上角（安全区内缩），半透明小字、指针穿透，不挡鼓盘与音符。
   - 30 帧上限的低档机上会真实显示 ~30，能直接反映自动降档效果。

## 技术细节

- `src/taiko/perf.ts`：QualityController 增加一个轻量 FPS 统计（复用现有 sample 入口累计帧数，1s 窗口求值，通过现有 subscribe 通知）。
- `src/taiko/FpsBadge.tsx`：改为订阅 quality 的 FPS 值，不再自开 rAF。
- `src/taiko/FallScreen.tsx`：在演奏区容器内挂载 `<FpsBadge />`（容器 relative）。
- `src/taiko/TaikoShell.tsx`：移除徽章与 relative 包裹（如无其他用途则还原）。

## 交付

改动打包成 zip 放到 /mnt/documents/，附文件清单；本地解压后按 bun install / electron:rebuild:asio / electron:pack:win 三步走。
