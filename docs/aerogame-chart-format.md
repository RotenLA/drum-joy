# AeroGame 通用谱面 JSON

谱面文件后缀为 `.aerogame-chart.json`，由后台导出，或用本地导出工具（Windows）生成，两者使用同一套算法，同一首歌的谱面内容一致。文件只包含歌曲信息、节拍基准和四档谱面，不包含音频、存储地址或后台凭据。

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
## 导出方式

### 后台导出（网页）

- 曲库每首歌旁的「导出谱面」按钮：下载该歌的 `歌名.aerogame-chart.json` 与同名 `歌名.png`。浏览器第一次可能询问「是否允许下载多个文件」，点允许即可。
- 曲库顶部的「导出全部谱面」按钮：下载一个 ZIP，内含一份总 JSON 与各首歌的封面 PNG。
- 需要先登录后台；导出数据不含音频存储地址、签名链接或任何后台凭据。

### 本地导出工具（Windows，免登录）

- 解压 `AeroGameChartTool-win32-x64.zip`，双击 `AeroGameChartTool.exe` 即可使用，全程离线，不上传任何文件。
- 「选择歌曲文件夹」：命名规则与后台上传相同，`歌名 - Drums` 与 `歌名_Drums` 均可识别，子文件夹内的文件也会找到；每首歌必须有 MIDI 文件，缺失会标为失败并跳过。
- 「选择导出文件夹」：点「开始导出」后逐首处理，每首歌输出 `歌名.aerogame-chart.json` 与 `歌名.png`；封面取自原曲内嵌封面，原曲没有封面时只输出 JSON。
- 工具与后台共用同一套谱面算法，同一首歌两者导出的谱面除 `exportedAt` 导出时间外内容一致；界面会记住上次选择的两个文件夹。
- 算法更新后想重新打包工具：解压源码包后运行 `bun install`，再运行 `bun run tool:pack:win`，新程序在项目的 `electron-release` 文件夹。
