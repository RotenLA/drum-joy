# 去掉同刻连线 + 实时鼓棒显示 + 调试打印小窗

## 一、去掉同刻音符连线

舞台下落式里那条把同一时刻音符连起来的发光细线整段移除，音符本身、等高时间线、判定和其他两种玩法都不动。

## 二、实时鼓棒显示（两根立体鼓棒）

宿主每帧调用 `window.__pd2uSticks({v:1, l:{p,y}, r:{p,y}})`，网页把两根鼓棒画在鼓阵上层。

- 新增全局接口 `__pd2uSticks`，守卫式、幂等挂载，与现有 MIDI 桥一起在启动时安装；参数缺失或越界忽略，`l`/`r` 为 `null` 时隐藏该棒。
- 角度换算：偏航 y 在 −45°…+45° 之间线性映射到鼓阵横向左右边缘，俯仰 p 在 −45°…+45° 映射到鼓阵纵向上下边缘。落点即棒尖位置。
- 外观：每根鼓棒画成一支带透视的立体棒身（近端粗、棒尖细，带高光与投影发光），左右棒用两种可区分颜色；棒身方向随偏航/俯仰倾斜，棒尖对准落点。
- 无数据（宿主从未调用，或超过约 300 毫秒没有新快照）时不绘制，界面与现在完全一致。
- 只有舞台下落式绘制鼓棒；节奏跑道与生存模式本轮不加。

## 三、可开关的调试打印小窗

- 游玩画面右下角一个小按钮开关一个半透明浮层小窗，标题「调试日志」，可清空、可暂停滚动。
- 记录内容：MIDI 敲击/松开（音符号、力度、对应鼓件名）、宿主注入的 note-on/off、鼓棒快照（按约 100 毫秒节流打印，避免每帧刷屏）、接口挂载与设备连接变化。
- 每条带毫秒时间戳，最多保留最近 200 条，超出丢弃最旧的；关闭小窗时不再消耗性能。

## 技术说明

- `src/taiko/stageRenderer.ts`：删除 `CHORD_TOL_MS`、`chords` 收集与连线绘制项；`StageFrame` 增加可选 `sticks` 快照，新增 `drawSticks()` 在鼓盘/音符之后绘制；角度→屏幕映射常量（`STICK_YAW_RANGE` / `STICK_PITCH_RANGE` / 颜色）集中在文件顶部。
- 新增 `src/taiko/stickInput.ts`：快照类型、`stickManager`（`latest()`、订阅、超时失效）、`installStickBridge()` 挂载 `window.__pd2uSticks`。
- 新增 `src/taiko/debugLog.ts`：环形缓冲 + 订阅；`src/taiko/DebugLogPanel.tsx` 浮层小窗组件。
- `src/taiko/midiInput.ts`：在 note-on/note-off/设备状态变化处调用 `debugLog.push`，区分「硬件」与「注入」来源。
- `src/taiko/TaikoShell.tsx`：与现有 `installExternalBridge()` 一起调用 `installStickBridge()`。
- `src/taiko/FallScreen.tsx`：rAF 帧里读取鼓棒快照传入 `StageFrame`，并渲染调试小窗开关。

## 交付

改动文件打包 zip 放 `/mnt/documents/`，附文件清单；另更新 `docs/unity-midi-bridge.md`，补一节鼓棒接口的调用示例。
