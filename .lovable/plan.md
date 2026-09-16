# 倒计时显示 4-3-2-1 + 切掉歌曲开头空白

## 现状（已确认）

- 教学舞台的音符从「预热 4 拍」之后才开始，但计时起点却设在音符开始前约 0.4 秒，所以大号数字只在最后不到半秒出现，看起来只有一个「1」。节拍器的 4 下预热本身是对的。
- 游玩页倒计时按当前歌曲速度算 4 拍，倒计时结束的瞬间音频从第 0 毫秒开始播。若音频文件开头有一段空白，那第一拍就是静音，听起来「慢了半天才出声」。
- 音轨与鼓 MIDI 目前都以「文件第 0 毫秒」为共同零点对齐。

## 要做的事

1. 教学倒计时改成完整的 4、3、2、1
   - 大号数字按「距离第一颗音符还有几拍」来算，预热 4 拍全程都显示，每拍换一个数字，和节拍器的四下滴答一一对应。
   - 教学的判定与视觉偏移沿用现有全局设置，不受影响。

2. 切掉每首歌开头的空白
   - 歌曲加载完成后，扫描四条音轨，找出最早出现声音的时刻（低于约 -50dB 视为空白），再往前留 30 毫秒余量，得到「开头空白长度」。
   - 播放时四条音轨统一从这个位置起播（同一个偏移，音轨之间的相对关系不变）。
   - 鼓谱（来自 MIDI）的所有时间同步减掉相同的偏移量，长音符、连线、缩圈提示一起跟着移动 —— 音轨与 MIDI 依旧严丝合缝。
   - 结果：倒计时最后一拍结束，下一拍音频立刻出声。
   - 若某首歌开头本来就没有空白，偏移为 0，行为与现在完全一致。

3. 顺带保证
   - 进度条、总时长、结束判定都按裁掉后的长度计算，不会出现结尾提前或拖尾。
   - 暂停/继续、重新开始仍从裁掉后的零点计算，不会错位。

## 技术细节

- `src/taiko/stems.ts`：新增 `leadSilenceMs(buffer)`（抽样扫描首个超阈值样本）与 `stemsLeadMs(stems)`（取四轨最小值，减 30ms 余量，clamp ≥ 0）。
- `src/taiko/songStore.tsx`：`SongState` 增加 `audioLeadMs`，在预设曲加载完成（`loadPresetSong` 之后写入 stems 的地方）计算一次并存入。
- `src/taiko/FallScreen.tsx`：
  - `playChart` 的 memo 末尾把 `notes[].timeMs` 与 `durationMs` 统一减 `audioLeadMs`（负值裁掉，`missCursor` 逻辑不变）。
  - `start()` 中 `songPlayer.play(0, songStartSec)` 改为 `songPlayer.play(audioLeadMs, songStartSec)`；无音频（纯 MIDI）路径不变。
- `src/taiko/tutorial/TutorialStage.tsx`：`countText` 改为按 `WARMUP_BEATS*BEAT_MS - t` 计算剩余拍数（`t < WARMUP_BEATS*BEAT_MS` 时显示 1..4），并把时钟起点 `startSec` 与预热首拍对齐，使数字与滴答同步。
- 谱面缓存不需要升级（偏移在运行时应用，不写入缓存）。

## 交付

改动打包成 zip 放到 /mnt/documents/，附文件清单；本地解压后按 bun install / electron:rebuild:asio / electron:pack:win 三步走。
