# 本次变更：安卓旧 WebView 兼容 + 新手教学恢复

## 1. 安卓旧 WebView 兼容

- JavaScript 与 CSS 统一兼容 Chrome / Android WebView 90。
- 不按 Android 系统版本直接拦截；检测实际内核与 Canvas、Web Audio 能力。
- 无法支持时显示九种语言的升级提示，建议更新 Android System WebView、Chrome 或系统。
- ResizeObserver 缺失时回退到窗口尺寸监听；毛玻璃不支持时回退实色背景。

## 2. 新手教学

- 不再自动进入教学，始终由用户点击选歌顶部的“教学”按钮手动进入。
- 已删除“连接适配器/连接鼓槌与踏板”两步（宿主要求设备连接完成后才能进入网页）。
- 左侧固定教学舞台，右侧显示步骤、检测状态、进度与操作按钮。
- 恢复适配器、鼓槌/踏板、鼓件认识、军鼓、底鼓、左踏板长音符和三组组合练习。
- 教学右上角“离开教学”只返回选歌，不与左上角退出整个网页冲突。

## 3. 文件清单

- src/taiko/platform.ts
- src/taiko/FallScreen.tsx
- src/taiko/SongPicker.tsx
- src/taiko/tutorial/steps.ts
- src/taiko/tutorial/TutorialStage.tsx
- src/taiko/tutorial/TutorialOverlay.tsx
- src/routes/__root.tsx
- src/routes/index.tsx
- src/styles.css
- vite.config.ts
- README-CHANGES.md

## 本地运行

解压并按原目录覆盖后运行：

1. `bun install`
2. `bun run electron:rebuild:asio`
3. `bun run electron:pack:win`
