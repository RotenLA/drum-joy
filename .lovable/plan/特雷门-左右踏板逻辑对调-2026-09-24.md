# 特雷门：左右踏板逻辑对调

## 现状
- 右踏板踩住 = 激活音符，松开 = 渐弱关闭
- 左踏板踩住 = 渐变为三角波，松开 = 渐变回正弦波
- 实现在 `src/taiko/theremin/ThereminScreen.tsx` 的踏板事件处理中（MIDI note36/44 的 on/off）

## 改动
1. **左踏板（踩住出声）**：踩下 = 激活音符（带启动淡入，避免爆音）；松开 = 音量渐弱至静音。左右脚事件完全互换。
2. **右踏板（点按切波形）**：每次踩下在 正弦 ↔ 三角 之间切换（带平滑渐变，沿用现有 crossfade 思路）；**忽略 note-off**，抬脚不产生任何效果。
3. 画面上的操作提示文案同步更新（左右踏板描述对调），中英两语都改。

## 技术细节
- 只改 `src/taiko/theremin/ThereminScreen.tsx`：交换 note36 与 note44 的处理分支；右踏板分支改为「on 时 toggle 波形、off 时直接 return」。
- 波形切换、淡入淡出参数沿用现有 `ThereminEngine.ts` 的接口，不动合成引擎。
- note36/44 具体哪个是左脚按现有代码映射对调，行为以「左脚=出声、右脚=切波形」为准。

## 交付
- zip 到 /mnt/documents，文件清单：`src/taiko/theremin/ThereminScreen.tsx`（如引擎小改则附 `ThereminEngine.ts`）
- 本地执行：`bun install` → `bun run electron:rebuild:asio` → `bun run electron:pack:win`
