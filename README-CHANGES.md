# 本次变更：长时间运行稳定性 + 密集音符突发延迟优化

## 1. 声音链路减负（src/taiko/drumKit.ts）

- 新增发声数量控制：单鼓件最多 3 声同时响，全局最多 14 声；超出时对最早那一声
  做 35ms 淡出掐音，密集连打不再把音频线程压满。
- 发声节点播完自动断开回收，不再堆积无用节点。
- 自适应发声提前量：平时 10ms（手感最直接），最近 300ms 内击打数 ≥6 时临时提到
  18ms，压住密集段的延迟尖峰。新增 `currentLookaheadMs()`、`activeVoiceCount()`。
- 只保留当前鼓组的采样在内存里（`releaseOtherKits()`），切换鼓组时释放旧采样，
  降低中低端安卓被系统回收的概率。

## 2. 击打传输平滑（src/taiko/midiInput.ts、src/taiko/FallScreen.tsx）

- 硬件 MIDI 消息改用消息自带的 `timeStamp` 作为击打时刻。一批消息一起回调时，
  原来统一取 `performance.now()` 会把它们压成同一时刻，表现为突发延迟/判定偏移。
- 击打迟到超过 400ms 的只出声不判定（写入调试日志），避免用错误时刻顶掉附近音符。

## 3. 长时间运行（src/taiko/FallScreen.tsx）

- 演奏与倒计时期间申请屏幕常亮（Screen Wake Lock），离开演奏自动释放；
  宿主未授权时静默跳过，交给安卓外壳的 KEEP_SCREEN_ON。
- 切后台/息屏自动暂停的行为保持不变（回前台不自动续播）。

## 4. 调试面板（src/taiko/FpsBadge.tsx）

调试日志开启时，左上角新增一行 `AU n / x ms`：当前同时发声数 / 当前发声提前量，
与已有的 `IN`（输入延迟）、`LF`（长帧）一起用于定位延迟到底出在哪一段。

## 5. 新增文档

`docs/android-host-checklist.md`：安卓外壳侧必改清单（前台服务、onTrimMemory
不销毁 WebView、硬件加速、WebView ≥111、击打逐条带时间戳、自检读数说明）。

## 文件清单

- src/taiko/drumKit.ts
- src/taiko/midiInput.ts
- src/taiko/FallScreen.tsx
- src/taiko/FpsBadge.tsx
- docs/android-host-checklist.md
- README-CHANGES.md
