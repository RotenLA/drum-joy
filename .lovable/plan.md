# 标准模式改为 7 分区，困难保留全部 9 件

## 目标

- 入门（5 分区）不变：底鼓、踩镲踏板、开/闭镲、军鼓、低通。
- 标准改为 7 分区：在入门基础上**增加吊镲、叮叮镲**（低通入门已有），即 底鼓 / 踩镲踏板 / 开闭镲 / 军鼓 / 低通 / 吊镲 / 叮叮镲。
- 困难：全部 9 件，不变。

## 改动

1. `src/taiko/laneLayouts.ts`
   - `LayoutMode` 增加 `"seven"`：`five | seven | nine`。
   - `VISIBLE_PARTS` 增加 seven 集：`hihat, snare, floorTom, pedalHat, kick, crash, ride`（不含高通、中通）。
   - 难度说明文案：`标准` 的 hint 改为「7 分区 · 节奏型重写」（在 difficulty.ts 的 DIFFICULTIES）。

2. `src/taiko/difficulty.ts`
   - `layoutOf("standard")` 返回 `"seven"`；`layoutOf("hard")` 仍为 `"nine"`。
   - `applyDifficulty` 的反查表改为遍历 nine（现有逻辑兼容，无需结构改动）。

3. `src/taiko/chartCache.ts`
   - 缓存键升到 `taiko.charts.v4`，旧固化谱面自动重建。

4. 游玩/谱面屏无需改动：鼓盘渲染按 `VISIBLE_PARTS[layout]` 过滤，标准模式自然只亮 7 个鼓盘（高通、中通变暗或不显示，沿用现有 5 分区的隐藏逻辑）。

## 验证

- `bunx tsgo --noEmit` + 构建。
- 用示例曲生成三档谱面，检查标准档音符只落在 7 个部件上。

## 交付

打包修改文件到 `/mnt/documents/taiko-standard-7lane.zip`，附文件清单。
