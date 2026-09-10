# 暂时去掉左踏板长音符

## 目标

谱面里不再出现左踏板（踩镲踏板）长音符，其余不变；代码上保留长音符支持，只是不生成，方便以后恢复。

## 具体改动

- `src/taiko/difficulty.ts`：`buildPlayChart` 里不再调用 `pedalHolds`（`holds` 直接为空数组），`pedalHolds`/`holdsToNotes` 函数保留但停用。这样三档难度都不会再产出带 `holdMs` 的音符。
- `src/taiko/chartCache.ts`：缓存键从 `taiko.charts.v2` 升到 `taiko.charts.v3`，让已固化的旧谱面重新生成，否则旧缓存里还带着长音符。

## 不需要动的部分

- `stageRenderer.ts` / `runwayRenderer.ts` 的长音符色带渲染、以及 `FallScreen.tsx` 的按住判定逻辑保留：没有 `holdMs` 的音符时这些代码自然不生效，不影响游玩。
- 入门踩镲四分优先、同一时刻最多两个手部件的限制都维持不变。

## 验证

- `bunx tsgo --noEmit` 通过、构建 OK。
- 用示例曲重新生成三档谱面，确认所有音符 `holdMs` 均为空、踏板行不再出现音符。
- 打包新/改文件到 `/mnt/documents/` 交付。
