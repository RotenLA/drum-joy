# AeroGame 谱面导出格式

每首歌导出一组文件（以歌名 `aLIEz` 为例）：

```text
aLIEz.info.json          歌曲信息：歌名、歌手、时长、速度、拍号、封面与各文件名
aLIEz - A - game.json    入门谱面
aLIEz - B - game.json    标准谱面
aLIEz - C - game.json    困难谱面
aLIEz.png                封面（原曲没有封面时不导出）
aLIEz_Vocals.mp3         人声分轨（仅本地工具导出）
aLIEz_Others.mp3         其他乐器分轨（仅本地工具导出）
aLIEz_Bass.mp3           贝斯分轨（仅本地工具导出）
```

不包含鼓分轨（鼓声由玩家击打产生）、存储地址或后台凭据。

## 歌曲信息 `歌名.info.json`

| 字段 | 含义 |
| --- | --- |
| `format` | 固定 `aerogame.song-info` |
| `schemaVersion` | 当前 `1` |
| `exportedAt` | ISO 8601 导出时间 |
| `id` | 稳定歌曲 ID |
| `title` / `artist` | 歌名 / 歌手（可能为 `null`） |
| `durationMs` | 歌曲音频总时长（毫秒） |
| `bpm` | 平均速度（展示用；计时请用谱面里的 `beatMap`） |
| `timeSignature` | 拍号，如 `[4, 4]` |
| `chartFingerprint` | 谱面版本指纹，变化即替换缓存 |
| `coverFile` | 封面 PNG 文件名，无封面为 `null` |
| `charts` | `{ "A": "...", "B": "...", "C": "..." }` 三份谱面文件名 |
| `difficultyLabels` | `A=beginner` 入门、`B=standard` 标准、`C=hard` 困难 |
| `audioTracks` | `vocals` / `others` / `bass` 分轨文件名，缺失为 `null` |

## 谱面 `歌名 - A|B|C - game.json`

只含谱面数据：

| 字段 | 含义 |
| --- | --- |
| `format` | 固定 `aerogame.chart-data` |
| `schemaVersion` | 当前 `1` |
| `songId` | 对应 info 的 `id` |
| `difficulty` | `A` / `B` / `C` |
| `difficultyLabel` | `beginner` / `standard` / `hard` |
| `timeUnit` / `coordinateSystem` | 固定 `milliseconds` / `song-start` |
| `durationMs` | 与 info 相同，即音频总时长；三档一致 |
| `beatMap` | 可选：`beats` 逐拍绝对毫秒、`beatsPerBar`、`barPhase`（首个重拍下标） |
| `grid` | 固定网格：`originMs`、`stepMs`（十六分）、`stepsPerBeat`、`stepsPerBar` |
| `notes` | 按时间升序的音符 |

### 音符字段

| 字段 | 含义 |
| --- | --- |
| `timeMs` | 相对音频起点的命中时刻（毫秒） |
| `midiNote` | General MIDI 打击乐音符号（36 底鼓、38 军鼓、42/46 闭/开镲、44 踩镲踏板等），鼓面由游戏按此映射 |

所有音符都是单击，没有持续时间。

## 接入步骤（音游开发）

1. 歌单页只读 `*.info.json`：歌名、歌手、封面、时长、速度。
2. 进入某难度时，按 `charts.A/B/C` 读对应谱面，校验 `format === "aerogame.chart-data"` 与 `schemaVersion === 1`。
3. 同时播放 `audioTracks` 中的三条分轨（同时起播，不要裁切开头）。
4. 时间对齐：音符位置 = `timeMs − 音频当前播放位置`；设备延迟校准由游戏自己处理。
5. 拍点：有 `beatMap` 用 `beatMap.beats`（保留动态速度），否则用 `grid`。
6. 轨道映射：用 `midiNote` 映射到自己的鼓面。
7. 缓存：`chartFingerprint` 变化即替换旧谱面。
8. 忽略不认识的新增字段。

## 导出方式

### 后台导出（网页，需登录）

- 每首歌的「导出谱面」：下载 `歌名.zip`，内含 info、A/B/C 三份谱面与封面。
- 「导出全部谱面」：下载一个 ZIP，内含每首歌的同一组文件。
- 后台导出不含音频，请另行提供分轨。

### 本地导出工具（Windows，离线）

- 双击 `AeroGameChartTool.exe`；选择歌曲文件夹与导出文件夹，点「开始导出」。
- 命名规则与后台上传相同（`歌名 - Drums`、`歌名_Drums` 均可）；每首歌必须有 MIDI。
- 每首歌输出上面列出的全部文件，分轨音频按原格式拷贝并改名。
- 与后台共用同一套算法；重打包：`bun install` 后 `bun run tool:pack:win`，产物在 `electron-release`。
