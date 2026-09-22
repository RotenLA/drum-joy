# 本次变更（单窗口选歌 + 全局设置弹窗）

1. 删除整块侧边栏，选歌与演奏舞台铺满窗口。
2. 未选中的中英文歌名统一整行逆时针旋转 90°；选中后恢复横向显示。
3. 选歌标签、搜索框、歌曲卡片和按钮改为轻圆角，并增强半透明玻璃填色与背景模糊。
4. 已选中并加载完成的歌曲右上角新增设置按钮；弹窗集中显示所有全局参数。
5. 「退出 / Exit」移入设置弹窗，仍只调用宿主的 `window.__pd2uExit()`。
6. 设置弹窗在手机横屏可上下滑动，搜索框继续保持 iOS 防自动放大处理。

## 变更文件
- src/taiko/SongPicker.tsx
- src/taiko/FallScreen.tsx
- src/taiko/TaikoShell.tsx
- src/taiko/GlobalSettings.tsx
- src/styles.css
- src/routes/index.tsx
- roadmap.md
