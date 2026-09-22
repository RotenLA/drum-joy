# 本次改动：敲击偶发延迟

1. 新增 `src/taiko/latencyMeter.ts`：输入抖动量表（输入延迟、长帧统计），仅统计不影响手感。
2. `src/taiko/FpsBadge.tsx`：调试面板开启时，帧率下方多两行 `IN 最近/最大ms`、`LF 长帧数(最近耗时)`。
   - IN 接近 0 而 LF 在涨 → 网页卡顿；IN 自己在跳 → 事件在宿主侧就晚了（请在调用 `__pd2uNoteOn` 时带上第三个参数：宿主毫秒时间戳）。
3. `src/taiko/drumKit.ts`：敲击发声由「立刻」改为固定 10ms 前瞻（`HIT_LOOKAHEAD_SEC`），消除随音频线程忙闲抖动；新增 `warmUpDrums()` 预热。
4. `src/taiko/FallScreen.tsx`：命中判定改为按鼓件索引 + 二分时间窗查找（不再遍历整曲）；开始时重置量表并预热鼓组样本。

文件清单：
- src/taiko/latencyMeter.ts（新增）
- src/taiko/FpsBadge.tsx
- src/taiko/drumKit.ts
- src/taiko/FallScreen.tsx
- roadmap.md
- README-CHANGES.md
