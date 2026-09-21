# 按开发接口文档对齐（PD2U Web ↔ Unity）

对照开发给的接口说明，网页这边有 5 处要改。其中 3 处是「还没做」，2 处是「做法和文档不一致」。

## 1 语言：改成由 URL 决定，支持 9 种

- 网址后面带 `?lang=zh`（可选 zh / zh-TW / ja / fr / ko / de / it / es / en），页面启动就用这个语言；认不出的码回落英文。
- 界面文案补齐 9 种语言：导航、游玩页（暂停、调音台、判定、难度、速度、画质、帮助）、谱面页、映射页、位置捕捉页，以及鼓件名、难度名、画质档名。
- 侧栏那个「中 / EN」手动切换按钮**去掉**——语言由宿主传入，页面不再自己切（也不再记在本地，避免和宿主传的值打架）。

## 2 设备状态：新增三个接口 + 2 秒提示窗

- 页面打开后先同步查一次 `__pd2uGetDeviceState()` 拿初始状态。
- 宿主推 `__pd2uDeviceState(快照)` 时更新内部状态。
- 宿主推 `__pd2uDeviceEvent(事件)` 时，屏幕中上方弹一个提示窗，显示「适配器已连接 / 左鼓棒已断开」之类（按当前语言），2 秒后自动消失；收到就弹，不做去重。
- 适配器断开（`m:false` 且全部 false）时同样只走提示窗，不阻塞游玩。

## 3 退出：改走宿主提供的 `__pd2uExit()`

- 现在是「一口气试七八种通道 + 直接调 vuplex」，文档明确不要这么做。改成只调 `window.__pd2uExit()`。
- 宿主没注入这个接口时（比如在电脑浏览器里打开），退出按钮**不显示**，不再弹那条「请用 App 内返回键」的提示。

## 4 鼓棒：角度范围收窄 + 停流时间对齐

- 俯仰/偏航按 −20°…+30° 映射到鼓阵范围（现在是 ±45°），手感覆盖更满。
- 判定「停流」的时间从 0.3 秒放宽到 1 秒，和文档一致，避免宿主推送抖动时光标闪掉。

## 5 击打：小口径校正

- `__pd2uNoteOn` 的音符号范围按文档收成 1–127（力度 0 视为静音/忽略）。
- 默认映射按文档表核对：36 底鼓、38 军鼓、41 低通、42/46 踩镲合打/开打、44 踩镲踩打、47 中通、48 高通、49 吊镲、51 叮叮镲——当前默认值与此一致，只补充文档里未列但我们额外兼容的音符说明，不改玩法。

## 技术细节

- `src/taiko/i18n.tsx`：`Language` 扩到 9 个码，语言来源改为 `URLSearchParams(location.search).get('lang')`，移除 localStorage 读写与 `setLanguage` 对外暴露；`tr(zh, en)` 保留作为兜底签名，新增 `t(key)` 按语言包取值。
- 新增 `src/taiko/locales/`（每语言一个字典）+ `t()` 查表，缺键回落英文。
- `src/taiko/deviceState.ts`（新）：`installDeviceBridge()` 挂 `__pd2uDeviceState` / `__pd2uDeviceEvent`，mount 时调一次 `__pd2uGetDeviceState()`；内部 store + 订阅；事件写 `debugLog`。
- `src/taiko/DeviceToast.tsx`（新）：监听事件，2 秒自动消失的提示窗（不用 sonner，避免与现有 Toaster 样式冲突）。
- `src/taiko/TaikoShell.tsx`：删 `exitApp()` 多通道实现，改 `window.__pd2uExit?.()`；退出按钮按 `__pd2uBridgeInstalled`/`__pd2uExit` 存在与否显示；删语言切换按钮；挂 `installDeviceBridge()` 与 `<DeviceToast />`。
- `src/taiko/stickCalibration.ts`：`pose.y / 45`、`pose.p / 45` 改为按 −20…+30 归一化（yaw 仍对称，pitch 非对称映射）。
- `src/taiko/stickInput.ts`：`STICK_STALE_MS` 300 → 1000。
- `src/taiko/midiInput.ts`：`injectNoteOn` 下界 note ≥ 1。
- `docs/unity-midi-bridge.md`：更新为与开发文档一致的四节（击打 / 鼓棒 / 语言 / 设备状态 / 退出）。

## 交付

改动源码打包 zip 放 `/mnt/documents/`，附文件清单；本地解压后跑 bun 三步。
