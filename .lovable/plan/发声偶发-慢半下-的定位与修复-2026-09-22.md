# 发声偶发「慢半下」的定位与修复

## 现状（已核对代码）

- 击打进来时会带上真实敲击时刻（`atMs`，和画面判定用的是同一个时刻）；但发声完全没有用它：
  `playDrum` 里排程时刻是「现在 + 10ms」（`ctx.currentTime + hitLookaheadSec`）。
- 结果：从硬件消息到达、到网页真正调用发声之间，只要主线程忙了一下（绘制长帧、垃圾回收、宿主批量投递），
  这段耽误会 **1:1 变成听感延迟**，而画面判定仍然按真实敲击时刻算 —— 正好是你描述的「判定都 PERFECT，声音偶尔不跟手」。
- 调试面板的 AUD 量的是「主线程时钟 vs 音频时钟的漂移」，量不到上面这段耽误，所以 AUD 看起来没问题是合理的，
  不代表没抖。
- 提前量只有 10ms，任何超过 10ms 的耽误都已经来不及补，只能原样变晚 —— 与你感觉到的「起码 20ms」量级一致。

结论：这不是音色采样本身的问题，是「什么时候让它响」的时间基准不对。

## 要做的修改

1. **按真实敲击时刻发声**
   发声时刻改为「敲击时刻 + 固定预算」，而不是「调用那一刻 + 10ms」。
   耽误没超预算时，声音落在同一个绝对时间点上，忽快忽慢直接被吸收掉；超预算就立刻发声（不做补偿性提前）。

2. **预算取值**
   固定预算按设备实际音频块长度算一次，范围约 18~30ms（现在是 8~20ms）。
   代价是整体固定多一点延迟，但是 **恒定的**，而且可以用现有的判定偏移设置抵掉；
   恒定的一点延迟远好过忽前忽后。

3. **新增一条可见的量表**
   调试面板 AUD 行加上「敲击→发声耽误」的当前值与峰值（HIT），这样你在安卓/苹果机上能直接看到抖动有多大、
   预算是否够用，而不用凭感觉。

4. **顺手减掉发声路径上的临时开销**
   - 单鼓件发声上限从 3 提到 4，减少快速连打时的掐音操作；
   - 掐音时的参数取消/斜坡合并成一次调用；
   - 发声结束回收的回调延后到空闲时批量做，不在敲击那一瞬间争主线程。

5. **音频时钟换算改用输出时间戳**
   有 `getOutputTimestamp()` 时用它把「敲击时刻」换算到音频时钟，比用 `currentTime` 直接相减更准；
   没有的设备保持原有方式。

## 技术细节

- `src/taiko/drumKit.ts`：`playDrum(part, velocity, kitId?, note?, atMs?)` 新增可选敲击时刻；
  内部 `scheduleTime(ctx, atMs)` 用 `getOutputTimestamp()`（`contextTime`/`performanceTime` 配对）或
  `currentTime` 回退，做 performance.now → ctx 时间换算；排程时刻 `max(now + minLead, mapped(atMs) + budget)`。
  `HIT_BUDGET` 由 `initHitLookahead` 依 `baseLatency` 定一次，钳在 0.018~0.030。
  新增 `hitDelayMs()` / `hitDelayPeakMs()` 导出，`resetAudioJitter` 一并清零。
  `MAX_VOICES_PER_PART` 4；`choke` 合并为单次 `setValueAtTime + linearRamp`；
  `onended` 里的 `dropVoice/recycleGain` 走一个微任务批处理队列。
- `src/taiko/FallScreen.tsx`：`hitPart` 把 `at` 透传给 `playDrum`。
- `src/taiko/tutorial/TutorialOverlay.tsx`：教学里的 MIDI 回调同样透传敲击时刻。
- `src/taiko/FpsBadge.tsx`：AUD 行追加 `HIT x/ypk ms`。
- `docs/android-host-checklist.md`：补一句宿主投递击打时务必带时间戳（已有接口，强调其对听感的作用）。

## 验证

- 类型检查 + 构建。
- 浏览器里注入击打并人为制造主线程长帧，确认发声排程时刻仍落在同一绝对时间点、HIT 峰值如实上升。
- 交付 zip 到 Files，附文件清单。
