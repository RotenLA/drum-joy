# 多轨 stem 导入 + 游玩内调音台

## 导入规则

- 一次拖入一组文件：`xxx_Vocals.mp3`、`xxx_Bass.mp3`、`xxx_Drums.mp3`、`xxx_Other.mp3`、`xxx.mid`。
- 主文件名 = 去掉 `_Vocals/_Bass/_Drums/_Other` 后缀与扩展名，用它把音轨和 MIDI 配成一首歌。
- mp3 可缺任意几个（也可一个都没有 = 静音试玩），mid 必需；缺 mid 时提示「缺少 MIDI，无法生成谱面」。
- 无后缀的单个 mp3（如 `xxx.mp3`）仍兼容，视为 Other 轨。
- 谱面屏配对信息里列出识别到的轨（Vocals / Bass / Drums / Other 各自的文件名与时长），并在时长不一致时给出提示（stem 已对齐首尾，只做校验）。

## 多轨播放

- 播放器改为多轨同步：所有 stem 共用一个起播时刻，各自一个 GainNode 汇到总输出，seek / 暂停 / 结束回调按最长轨判定。
- 峰值：导入时对每条轨算出样本峰值，音量滑杆的 100% 即「原始文件音量」，不做超过峰值的放大。
- 初始音量：Vocals / Bass / Other = 100%，**Drums = 0（无声）**。

## 游玩界面调音台

- 游玩屏加一个可折叠的「调音台」面板（右上角按钮开合，风格沿用现有纸墨/描边 UI，不遮挡舞台）。
- 两条滑杆：**Vocals**、**Drums**，0% ~ 100%（100% = 文件峰值），实时生效，游玩中可随时调整。
- Drums 默认 0，用于「跟不上时把原鼓声开出来当参考」。
- Bass / Other 不出现在面板里，固定 100%。
- 音量设置持久化到 `taiko.settings.v3`，下次进入沿用（Drums 仍每次重置为 0 还是记住上次——记住上次）。

## 技术说明

- 新增 `src/taiko/stems.ts`：文件名解析（stem 类型识别 + 主名归并）与峰值计算。
- 改写 `src/taiko/player.ts`：`SongPlayer` 从单 buffer 改为 `Record<StemKind, AudioBuffer>` + 每轨 GainNode，新增 `setStemGain(kind, v)`、`stemPeaks`；`timeMs/seek/pause/play/setOnEnded` 接口保持不变，调用方无需大改。
- `src/taiko/songStore.tsx`：`audioBuffer/audioFileName` 换成 `stems: Record<StemKind, {buffer, fileName, peak}|null>`，新增 `mix: { vocals: number; drums: number }` 并持久化；`durationMs` 取各轨最大值。
- `src/taiko/ChartScreen.tsx`：导入逻辑按 stem 分组，配对信息展示各轨。
- `src/taiko/FallScreen.tsx`：新增调音台面板组件与滑杆，接 `songPlayer.setStemGain`。
- 判定、谱面生成、渲染层不变。

## 交付

改动源码按目录结构打包 zip 放到 `/mnt/documents/`，附文件清单；本地解压后跑 bun 三步。
