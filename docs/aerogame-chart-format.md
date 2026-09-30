# AeroGame 通用谱面 JSON

后台导出的文件后缀为 `.aerogame-chart.json`。它只包含歌曲信息、节拍基准和四档谱面，不包含音频、封面、存储地址或后台凭据。

## 顶层字段

| 字段 | 含义 |
| --- | --- |
| `format` | 固定为 `aerogame.chart-package` |
| `schemaVersion` | 当前为 `1`；读取方应先检查版本 |
| `exportedAt` | ISO 8601 导出时间 |
| `timeUnit` | 固定为 `milliseconds` |
| `coordinateSystem` | 固定为 `song-start`，所有时间都相对歌曲文件起点 |
| `songs` | 一首或多首歌曲；单曲导出也使用数组 |

## 歌曲与谱面

每首歌曲包含稳定 `id`、标题、艺人、时长、BPM、拍号、`chartFingerprint`、`coverFile`（与 JSON 同目录的封面 PNG 文件名；无封面为 `null`）和四档 `charts`：

- `easy`：轻松
- `beginner`：入门
- `standard`：标准
- `hard`：困难

每档谱面包含 `durationMs`、`grid`、可选 `beatMap` 和按时间升序排列的 `notes`。若 `beatMap` 存在，应优先使用其中的逐拍绝对毫秒时间；它能保留真人演奏或动态速度变化。`grid` 是没有动态拍点时的固定网格基准。

## 音符字段

| 字段 | 含义 |
| --- | --- |
| `timeMs` | 音符相对歌曲起点的命中时刻（毫秒） |
| `instrument` | 与界面无关的英文鼓件 ID，如 `bass-drum`、`acoustic-snare` |
| `inputLane` | 原玩法输入组：`don` 为脚部输入，`ka` 为手部输入 |
| `midiNote` | General MIDI 打击乐音符号；源谱未记录时为 `null` |
| `drumName` | 对应 MIDI 鼓件的中英文名称 |
| `big` | 是否为重击音符 |
| `holdMs` | 可选持续时间；没有该字段即为单击 |

其他音游应优先用 `instrument` 或 `midiNote` 映射自己的轨道，不要依赖 AeroGame 的舞台位置或画面布局。

## 兼容规则

1. 读取前检查 `format` 与 `schemaVersion`。
2. 忽略不认识的新增字段，避免小版本扩展导致读取失败。
3. `chartFingerprint` 改变表示该歌曲谱面已更新，应替换旧缓存。
4. 不要对音符时间再叠加 AeroGame 的本机校准值；播放设备校准应由目标游戏自行处理。

读取示例见 `examples/read-aerogame-chart.ts`。
## 封面文件

单曲导出下载 JSON 与同名 PNG 两个文件；全库导出为一个 ZIP，内含总 JSON 与各首封面 PNG。
