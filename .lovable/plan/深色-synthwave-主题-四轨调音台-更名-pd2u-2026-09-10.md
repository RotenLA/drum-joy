# 深色 Synthwave 主题 + 四轨调音台 + 更名 PD2U

## 目标

1. 整个工作台界面改为深色 synthwave 配色（演奏画面本身不动）。
2. 调音台改为四轨（Vocals / Drums / Bass / Other），常驻展开在演奏画面下方，不再叠在画面内。
3. 左上角标题「太鼓」改为「PD2U」，浏览器标签页名称中的「太鼓」也一并改成 PD2U。

## 具体改动

### 深色配色
- 在全局样式中把工作台用的一组颜色变量改成深色 synthwave：近黑偏紫的底色、淡紫灰文字、霓虹粉主色、青蓝副色、半透明紫色分隔线，并保留原有变量名，这样所有界面自动跟着变。
- 侧边导航、顶部信息栏、谱面页、映射页的按钮/输入框/卡片沿用这些变量，选中项用霓虹粉高亮、悬停用淡紫。
- 演奏画布内部的绘制（鼓面、音符、背景封面、HUD）完全不改。

### 调音台
- 从演奏画面里移除右上角的「调音台」按钮和浮层。
- 在演奏画面正下方新增一块常驻面板，四条推子：Vocals、Drums、Bass、Other。100% = 原始文件音量；缺失的音轨显示为「无此轨」并禁用。
- Drums 默认仍为 0（无声），Vocals/Bass/Other 默认 100%。
- 四轨音量都实时作用到播放器，并存进本地设置（升级设置存储键，旧的两轨设置自动补齐默认值）。

### 更名
- 侧边栏标题改为 PD2U。
- 首页标题与描述、社交预览标题中的「太鼓」改为 PD2U。

## 技术要点

- `src/styles.css`：改写 `--taiko-paper / surface / line / ink / don / ka` 为深色 synthwave oklch 值，并新增霓虹强调色变量。
- `src/taiko/songStore.tsx`：`MixState` 扩展为四个键，默认 `{vocals:1, drums:0, bass:1, other:1}`，`SETTINGS_KEY` 升级到 `taiko.settings.v4`，读取时逐键 clamp 并回退默认。
- `src/taiko/FallScreen.tsx`：删除 `mixerOpen` 状态与画面内浮层；音量 effect 遍历 `STEM_KINDS` 调 `songPlayer.setStemGain`；在 16:9 容器下方渲染新的 `MixerPanel`（可放同文件或 `src/taiko/MixerPanel.tsx`），用 `STEM_LABEL` 生成四条推子。
- `src/taiko/TaikoShell.tsx`：标题文案改 PD2U；配色随变量自动生效，必要处调整对比度类名。
- `src/routes/index.tsx`：`head()` 中 title / description / og:title 更名。
