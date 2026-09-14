# 判定偏移固定 80ms + 消除开场那一下卡顿

## 1. 判定偏移默认 80ms

- 判定偏移的初始值从 0 改成 80ms，滑杆和「自动校准」照旧可以改。
- 校准记录换一个新的存档键，这样你和用户机器上原本存着的 0 会被新的默认值 80 取代，而不是继续沿用旧值。
- 界面上滑杆的默认位置也跟着落在 80。

## 2. 倒计时结束时音符「顿一下」的原因与修正

现在倒计时用的是画面时钟（浏览器帧计时），歌曲开始后改用音频时钟，而音频为了稳一点会推迟约 50 毫秒起播，再减去设备输出延迟。两套时钟对不齐，所以切换的那一瞬间音符位置会跳一下。

修正做法：整段倒计时和歌曲用同一个音频时钟。

- 点「开始」时就把歌曲排好在一个确定的音频时刻起播（倒计时四拍之后），倒计时期间的时间直接由这同一个时刻倒推，得到从负数平滑走到 0 的连续时间。
- 倒计时的节拍器也挂到这同一个音频时刻上排程，第一拍与音符落线严丝合缝。
- 到 0 时只切换状态，不再重设时间起点，因此音符不会跳位。
- 暂停/继续、重来、无音频（只有 MIDI 没有音轨）这几条路照旧可用：无音频时仍走画面时钟，但同样一次算好起点。

## 技术细节

- `src/taiko/calibration.ts`：`DEFAULT_CALIBRATION.judgeMs = 80`，存档键升到 `taiko.calib.v2`（旧键不再读取）。
- `src/taiko/player.ts`：`play(fromMs?, atCtxSec?)` 支持指定绝对起播的 AudioContext 时刻，并暴露 `startTimeSec()` / `nowMs()`（可返回负数，等于 `(ctx.currentTime - startCtxSec)*1000 - outputLatency`）。
- `src/taiko/FallScreen.tsx`：`start()` 计算 `startCtxSec = ctx.currentTime + lead + COUNT_IN_BEATS * beatMs/1000`，调用 `songPlayer.play(0, startCtxSec)`；节拍器四拍用音频时刻排程；`readTimeMs()` 在 `countdown` 与 `playing` 两个阶段统一读音频时钟；倒计时数字也由该时间推出；无音频分支用一次算好的 `silentStartRef`。
- 倒计时→播放的状态切换改由时间达到 0 时触发（帧循环里判断），不再依赖 `setTimeout` 的抖动。

## 交付

改动文件打包 zip 放 `/mnt/documents/`，附文件清单，本地解压后跑 bun 三步。
