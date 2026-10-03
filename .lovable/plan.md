# 谱面文档补充：PNG 用法与开发者接入步骤

## 背景

用户已用后台真实导出 `aLIEz.aerogame-chart.json` + `aLIEz.png`，验证无误，准备交给其他游戏的开发。现有 `docs/aerogame-chart-format.md` 已说明字段，但缺少两点：PNG 的用途说明，以及一个从拿到文件到音游里能玩的接入步骤。开发拿到文件后应能照文档独立完成接入，不需要回问。

## 文档改动（docs/aerogame-chart-format.md）

1. 新增「## 封面 PNG 的用法」：
   - PNG 与 JSON 通过歌曲的 `coverFile` 字段配对（默认与 JSON 同名），只作展示用途：歌单封面、选中详情、加载画面；不包含任何谱面或游戏数据。
   - 每张约 800×800 方形；目标游戏可自行压缩缩放，改名后需同步更新 `coverFile`；没有封面的歌该字段为 `null`，游戏需自行准备默认图。
   - 玩法画面用不用封面由目标游戏自定；封面缺失不影响谱面读取。

2. 新增「## 接入步骤（音游开发）」：
   - 校验 `format` === `aerogame.chart-package` 且 `schemaVersion` === 1，不满足拒绝读取。
   - 选难度：`easy`/`beginner`/`standard`/`hard`，对应轻松/入门/标准/困难。
   - 时间对齐：所有 `timeMs` 以音频文件起点为 0；音游直接用 `timeMs - 音频播放当前位置` 放置音符；玩家延迟/设备校准由目标游戏自己加，不要再叠 AeroGame 的偏移。
   - 拍点优先级：有 `beatMap` 用 `beatMap.beats`（逐拍绝对毫秒，保留动态速度），没有才退回 `grid`（`originMs` + `stepMs` × 步数）。
   - 轨道映射：优先用 `instrument` 或 `midiNote`（General MIDI 鼓件）映射自己的轨道；`inputLane`（don=脚部/ka=手部）与 `big`、可选 `holdMs` 供需要的游戏使用；不要依赖 AeroGame 的画面布局。
   - 缓存：`chartFingerprint` 变化即替换旧谱面缓存。

3. 同步更新 `examples/read-aerogame-chart.ts`：示例里加一行展示 `coverFile` 如何与 PNG 配对，让示例可直接对应真实导出文件。

## 交付

- 修改文件打包 ZIP 放 `/mnt/documents`（含 FILES.txt 清单）：docs/aerogame-chart-format.md、examples/read-aerogame-chart.ts。
- 交付前跑类型检查确认示例文件可编译。
