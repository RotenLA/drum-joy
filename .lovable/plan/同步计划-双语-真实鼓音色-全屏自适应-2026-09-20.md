# 同步计划：双语 + 真实鼓音色 + 全屏自适应

按你的选择：**同步 1（中英双语）和 2（真实鼓音色库）**，**4 改成全屏自适应**（不做固定手机画布），**3（教程）先不做**，**5、6 不做**。

## 1. 中英双语切换

- 新增语言上下文（中文默认，选择记在本地，下次打开保留）。
- 左侧导航栏顶部加一个 中/EN 小开关。
- 全部界面文案双语：导航、游玩页（暂停、调音台、判定、难度、速度、画质、帮助气泡）、谱面页、映射页、位置捕捉页。
- 鼓件名、难度名、画质档位、音符名都补英文名。
- 我们独有的「位置捕捉」和帧数徽章，对方没有对应文案，这部分英文由我来写。

## 2. 真实鼓音色库（9 套鼓组）

- 打鼓声从现在的合成音改成真实采样：Pop / Funk / Rock / 808 / Club / Sub / Perc / Table / Toy 共 9 套，每套 9 个鼓件。
- 谱面页全局设置里加「鼓组」下拉，切换即生效；「本地鼓声」开关保持现在的行为。
- 采样在后台加载，没加载完或加载失败时自动退回现在的合成音，不会出现没声音。
- 音频文件目前挂在另一个工程上，不能直接引用。我会把它们逐个取回并重新上传到本工程（每套 9 个，共 81 个文件，优先用兼容性最好的 m4a 格式）。如果有个别文件取不回来，我会在完成时明确告诉你是哪几个，那几个鼓件继续用合成音。

## 3. 全屏自适应（替代固定 17:7）

- 整个应用改为**铺满窗口**，不再留黑边：Unity 里进入就是满屏，无论设备比例多少。
- 左栏与内容区仍按比例分配宽度，窄屏时左栏自动收窄。
- 演奏区目标仍尽量接近 14:5：宽屏时按 14:5 居中，窗口更方时自动让演奏区变高、底部控制栏压扁，保证不裁掉鼓盘和调音台。
- 保留已有的安全区边距、安卓触摸滚动修复。

## 暂不处理

- 新手教程（3）：等这三项稳定后再单独做。
- 固定手机画布、全屏按钮、加粗鼓棒（4 的原实现、5、6）：与我们现在的布局和位置捕捉冲突，不同步。

## 技术细节

- 新增 `src/taiko/i18n.tsx`（LanguageProvider / useLanguage / tr），在 `__root.tsx` 外层包裹；非 React 的桥接日志用 `getActiveLanguage()`。
- 新增 `src/taiko/kitSamples.ts`（重新上传后的 URL 清单）；`drumKit.ts` 增加 `KIT_NAMES`、`loadKitId/saveKitId/subscribeKitId`、`ensureKitLoaded`、采样优先 + 合成兜底的 `playDrum`。
- `styles.css`：`.taiko-root` 去掉 `aspect-ratio: 17/7` 与 min() 锁宽高，改为 `width:100%; height:100dvh`；`FallScreen` 的 `grid-rows-[5fr_2fr]` 改成按容器比例动态取值（宽屏 5:2，窄屏收紧底栏）。
- 涉及文件：`i18n.tsx`(新)、`kitSamples.ts`(新)、`drumKit.ts`、`GlobalSettings.tsx`、`TaikoShell.tsx`、`FallScreen.tsx`、`ChartScreen.tsx`、`MappingScreen.tsx`、`PositionCaptureScreen.tsx`、`FpsBadge.tsx`、`laneLayouts.ts`、`difficulty.ts`、`perf.ts`、`helpTexts.ts`、`styles.css`、`routes/__root.tsx`。
- 交付：打包 zip 到 /mnt/documents/ 并附文件清单。
