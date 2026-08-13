# 空气鼓「上/下」音符映射表（太鼓谱面第一步）

只做一件事：把鼓件 MIDI 音符固化成一张「下（红/咚）」「上（蓝/咔）」映射表，供后续谱面生成模块调用。不做谱面生成、不做拍号/BPM 识别。

## 确认的映射

下组（DOWN，6 个）
- 38 军鼓 Acoustic Snare
- 40 电军鼓 Electric Snare
- 42 闭踩镲 Closed Hi-Hat
- 46 开踩镲 Open Hi-Hat
- 41 低落地嗵 Low Floor Tom
- 43 高落地嗵 High Floor Tom

上组（UP，7 个）
- 51 叮叮镲 Ride Cymbal 1
- 52 中国镲 Chinese Cymbal
- 49 强音镲 Crash Cymbal 1
- 48 高中嗵 Hi-Mid Tom
- 50 高嗵 High Tom
- 45 低嗵 Low Tom
- 47 低中嗵 Low-Mid Tom

不参与谱面：35 / 36 底鼓、44 踩镲踏板，以及任何未列出的音符（返回 null，由调用方忽略）。

## 交付内容

一个独立模块 `src/shared/drumLaneMap.ts`（纯 TS，无依赖，Electron 主进程与渲染进程均可 import）：

- `DrumLane` 类型：`'down' | 'up'`
- `DRUM_LANE_MAP: Record<number, DrumLane>` — 上表 13 条
- `IGNORED_DRUM_NOTES: ReadonlySet<number>` — 35、36、44
- `DRUM_NOTE_NAMES: Record<number, string>` — 中英文名称，便于 UI 显示与调试
- `getDrumLane(note: number): DrumLane | null` — 未映射或忽略音符返回 null
- `DOWN_NOTES` / `UP_NOTES` 数组导出，便于遍历与做设置面板

配套一份 `docs/drum-lane-map.md` 说明表格与「未列出音符不发谱面音符」的约定。

## 技术说明

- 纯常量与查表函数，无副作用，可被后续谱面生成器、自动挡模块、UI 图例复用。
- 后续若要支持用户自定义映射，只需在此模块之上加一层覆盖对象，核心表保持默认值不变。

## 交付方式

按你的习惯：所有新增/修改文件打包成 zip 放到 /mnt/documents/，附文件清单，你解压到本地工程即可。
