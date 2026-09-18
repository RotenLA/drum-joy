# 导出整个 Web App 源代码给 Unity 同事

## 目标
把当前项目的完整网页应用源代码打包成一个 zip，供 Unity 同事参考/复刻。

## 打包内容
- 包含：`src/`（全部页面、太鼓模块、渲染器、MIDI/鼓棒桥接等）、`public/`、`docs/`、`package.json`、`vite.config.ts`、`tsconfig.json`、`src/styles.css` 等配置与样式文件。
- 排除：`.git`、`node_modules`、构建产物（`dist` 等）、`.lovable/` 计划与内部文件、`roadmap.md`。
- 歌曲资源（mp3/mid 的 `.asset.json` 指针文件）一并带上；如果指针不含实际音频数据，会在交付说明里提醒同事音频文件需要另行提供。

## 交付
- 在 /tmp 组装干净源码目录，核对其递归清单（含隐藏文件）后打成 zip 放到 /mnt/documents/，附文件清单说明。
- 附一份简短 README 说明：技术栈（React 19 + TanStack Start + Vite + Canvas 2D 渲染）、入口文件、太鼓核心模块位置（`src/taiko/`），以及与 Unity 对接的桥接接口（`window.__pd2uNoteOn` MIDI 注入、`window.__pd2uSticks` 鼓棒姿态注入，文档见 `docs/unity-midi-bridge.md`）。
