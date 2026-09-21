# 退出按钮修复 + 固定深色 + 黑橙鼓面新皮肤

## 1. 退出按钮点击无效

浏览器不允许网页自己关掉标签页，所以现在点了没反应。改成多路通知宿主，谁接得住就由谁关：

- 依次尝试：UniWebView 约定链接（`uniwebview://exit`）、Vuplex 消息、Unity 的 `sendMessage`/`Unity.call`、父窗口消息。
- 仍然无人响应时（例如在浏览器里打开），弹一行提示告诉用户「请在 App 内返回」，而不是静默无反应。
- 会把用到的通知方式写进 Unity 对接文档，同事在 Unity 侧接住其中任意一种即可真正退出。

## 2. 强制深色，不跟随系统

- 页面根节点固定标记为深色，并声明 `color-scheme: dark`，系统切浅色也不变。
- 不再有浅色配色可被选中，避免 Unity 内嵌时忽明忽暗。

## 3. 换成你发的黑橙皮肤

### 鼓面
从你发的第一张图里裁出 7 个鼓面（黄、粉、青、紫、橙、蓝、绿）作为贴图，按现有鼓盘位置和大小贴到舞台上，替换现在代码画的圆盘。命中时发光圈变亮一下，Miss 时变暗，保持现在的手感反馈。

鼓面颜色与部件对应（按图上排布）：吊镲=黄、高通=粉、中通=青、叮叮镲=紫、踩镲=橙、军鼓=蓝、地通=绿。

### 踏板
裁出橙、黑两种踏板图：**橙色=踩下，黑色=松开**。踩镲踏板和底鼓都用这套图，按当前踩放状态切换；长音符踩住期间保持橙色。

### 背景
换成同样感觉的深色演出现场背景（深黑、暖橙微光、极淡颗粒），取代现在的歌曲封面压灰底。

### 整体配色
侧栏、按钮、文字、滑杆、选中态从现在的黑底粉紫改为**黑底橙色高亮**，四个界面统一。

## 技术细节

- `TaikoShell.tsx`：`exitApp()` 改为多通道（`uniwebview://exit` → `window.vuplex.postMessage` → `window.unityInstance?.SendMessage` / `Unity.call` → `parent.postMessage` → `window.close()`），全部无效时用 sonner 提示；提示文案中英双语。
- `src/routes/__root.tsx`：`<html lang className="dark">`，meta `color-scheme: dark`；`styles.css` 里 `:root` 直接采用深色值并加 `color-scheme: dark`，移除浅色依赖。
- 素材：用 Python/PIL 从两张上传图中按坐标裁出 7 个鼓面 + 2 个踏板，去背存为 PNG，经 `lovable-assets` 上传，写入 `src/assets/pads/*.asset.json`；背景用 imagegen 生成 1920×960 深色现场图存 `src/assets/stage-bg.jpg`。
- `stageRenderer.ts`：新增贴图加载与缓存（`HTMLImageElement`，按 dpr 烘焙尺寸），`drawPad` 改为贴图绘制 + 发光/暗化叠色；踏板按 `pressed` 状态选图；背景改用新底图，去掉封面绘制分支。贴图未加载完时退回现有画法，避免首帧空白。
- `laneLayouts.ts`：每个部件加贴图 key。
- `styles.css`：`--taiko-accent` 改橙（约 `oklch(0.72 0.19 55)`），`--taiko-accent-2` 改暖黄，面板底色更黑。
- 交付：打包改动文件 zip 到 /mnt/documents/ 并附文件清单。
