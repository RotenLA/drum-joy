# Unity 嵌入：MIDI 双通道对接

目标：无论 Unity 用哪种 WebView 嵌入，硬件鼓都能控制鼓面。

## 通道一：Chromium WebView（Vuplex / CEF）

现有链路不变：网页通过 Web MIDI API（`navigator.requestMIDIAccess`）直接读硬件，映射屏选设备、游玩屏判定全部照常。仅需在文档中说明嵌入侧要放行 MIDI 权限（CEF 需处理 permission request，Vuplex 有对应开关）。

## 通道二：Unity 原生读 MIDI → JS 桥注入

系统 WebView 没有 Web MIDI，由 Unity 侧读 MIDI，调网页暴露的全局函数注入事件。

### 改动

- `src/taiko/midiInput.ts`：
  - `MidiManager` 增加 `injectNoteOn(note, velocity)` / `injectNoteOff(note)` 方法，直接复用现有 listener 集合，与硬件消息走完全相同的映射、判定、鼓盘闪光逻辑；
  - 新增 `installExternalBridge()`：挂载 `window.__pd2uNoteOn(note, velocity)` 与 `window.__pd2uNoteOff(note)`，参数做范围校验（note 0–127，velocity 1–127），重复挂载幂等。
- `src/taiko/TaikoShell.tsx`：挂载时调用一次 `installExternalBridge()`。
- 映射屏底部「实时收到音符」的闪烁同样对注入事件生效（本来就走同一 listener，无需额外改动）。

### Unity 侧对接约定（写进交付说明）

```text
敲击：__pd2uNoteOn(36, 100)     // note 0-127, velocity 1-127
松开：__pd2uNoteOff(36)          // 长音符判定用
```

Unity 拿到原生 MIDI 包后解析状态字节（0x90=敲、0x80=松），调 WebView 的 EvaluateJavaScript 注入即可；无 Web MIDI 时网页设备下拉显示「由宿主注入」，属正常。

## 交付

改动源码打包 zip 放 `/mnt/documents/`，附文件清单与一页《Unity 对接说明》（两通道的权限/调用示例）。本地解压跑 bun 三步。
