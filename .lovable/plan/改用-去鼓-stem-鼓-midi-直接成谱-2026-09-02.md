# 改用「去鼓 stem + 鼓 MIDI」直接成谱

放弃从音频里猜鼓声，改成直接吃你给的两份素材：伴奏音频（已去掉鼓）和对应的鼓 MIDI。谱面 = MIDI 音符，速度/拍号全部读 MIDI 自带的 tempo / time signature map。游玩屏用难度三档控制分区与复杂度。

## 导入流程（谱面屏改版）

- 一个导入区，可一次或多次选文件，音频（mp3/wav）与 MIDI（mid/midi）都收；**同主文件名自动配对**（如 `Track01.wav` + `Track01.mid`）。
- 配对成功后显示：曲名、时长、MIDI 音符数、tempo map（含变速点数量）、拍号。
- 只有音频没 MIDI：提示「缺少 MIDI，无法生成谱面」；只有 MIDI 没音频：可静音试玩。
- 速度/拍号只来自 MIDI；界面上仍显示数值，允许手动整体微调偏移（音频与 MIDI 起点对不齐时用）。

## 谱面生成

- MIDI 音符 → 鼓件：沿用现有 GM 鼓映射（`drumLaneMap`），把 note 归到 9 个部件；未覆盖的 GM 音符就近归并（如 GM 边击→军鼓、各类牛铃/手鼓→通鼓或忽略）。
- 力度：velocity 高于阈值标记为重击（big）。
- 变速支持：按 MIDI tempo map 把 tick 精确换算成毫秒，变速曲同样对齐。

## 难度三档（游玩屏）

替换现在的「分区」按钮，改成「难度：入门 / 标准 / 困难」：

- **入门**：5 分区 + 原 MIDI。只保留底鼓、踩镲、开/闭镲、军鼓、低通，其余音符丢弃（不搬移），并做最小间隔限制，避免打不出的连打。
- **标准**：9 分区 + 原 MIDI，一音不改。
- **困难**：9 分区 + 原 MIDI + **适度**加密加花——乐句末（每 4 或 8 小节）加一次短过门，密集段落的镲细分适度加倍，比例受控（新增音符不超过原谱约 15%）；确定性生成，同曲每次一致。

## 移除的旧功能

音频鼓声分析、歌曲段落分析、自定义节奏编辑器、谱面难度/倾向风格模块全部下线，谱面屏只剩「导入 + 配对信息 + 节拍器试听 + 谱面预览」。游玩屏的 osu! 模式与舞台下落模式都保留，共用新谱面。

## 技术说明

- 新增 `src/taiko/midiFile.ts`：纯 JS 解析 SMF（header / track / varint / tempo / time signature / note on-off），无新依赖或使用轻量 `@tonejs/midi`（择轻者）。
- 新增 `src/taiko/midiChart.ts`：MIDI → `TaikoChart`（tick→ms 走 tempo map，velocity→big，GM→lane）。
- 新增 `src/taiko/difficulty.ts`：三档定义 + 入门过滤 + 困难加花（确定性种子）。
- 修改 `src/taiko/songStore.tsx`：state 换成 `audioFile / midiData / difficulty`，删除 segments / customPattern / density / style；持久化只留 `difficulty`、`speed`、`playMode`、MIDI 设备。
- 修改 `src/taiko/ChartScreen.tsx`：重写为导入配对界面。
- 修改 `src/taiko/FallScreen.tsx`：分区由难度推导，谱面来自 `difficulty` 加工后的 MIDI 谱。
- 修改 `src/taiko/TaikoShell.tsx`：设置键改版。
- 删除 `drumAnalyze.ts`、`grooveMatch.ts`、`groovePatterns.ts`、`grooveStyles.ts`、`arrange.ts`、`chartSimplify.ts`、`beatDetect.ts`、`audioMeta.ts`（BPM 检测不再需要）。
- 渲染层（`stageRenderer.ts` / `osuRenderer.ts` / `laneLayouts.ts`）不动。

## 交付

改动与新增源码按目录结构打包 zip 放到 `/mnt/documents/`，附文件清单；本地解压后跑 bun 三步。
