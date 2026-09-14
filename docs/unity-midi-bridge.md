# PD2U × Unity 对接说明：MIDI 双通道

## 通道一：Chromium WebView（Vuplex / 内嵌 CEF）

网页直接通过 Web MIDI API 读硬件，无需 Unity 转发：

- 网页内调用 `navigator.requestMIDIAccess()`，首次会请求 MIDI 权限；
- CEF：需要处理 `OnPermissionRequest`（或在启动参数允许 MIDI），放行 `midi`/`midiSysex` 权限请求；
- Vuplex：确认版本支持 Web MIDI 并开启对应权限开关；
- 放行后，网页「映射」屏的设备下拉即可看到硬件，选定后游玩屏正常判定。

## 通道二：Unity 原生读 MIDI → JS 桥注入

系统 WebView 不支持 Web MIDI 时使用。网页加载后会在 `window` 上暴露两个函数：

```text
敲击：window.__pd2uNoteOn(note, velocity)   // note 0-127，velocity 1-127
松开：window.__pd2uNoteOff(note)            // 长音符判定用
```

Unity 侧流程：

1. 用原生方式读 MIDI 输入（C# 插件或平台 API），拿到原始 MIDI 包；
2. 解析状态字节：`0x9n` 且力度 >0 = 敲击，`0x8n`（或 `0x9n` 力度 0）= 松开；
3. 调 WebView 的 JS 执行接口注入，例如：

```csharp
// 敲击 36 号音符，力度 100
webView.EvaluateJavaScript("window.__pd2uNoteOn(36, 100)");
// 松开
webView.EvaluateJavaScript("window.__pd2uNoteOff(36)");
```

注入事件与真实硬件走完全相同的逻辑：映射屏的部件映射、实时音符闪烁、游玩屏判定（Perfect/Good/Miss）、长音符「全程按住」判定全部生效。

注意：

- 音符号以网页「映射」屏配置的为准（默认底鼓 36、踩镲踏板 44 等，用户可改）；
- 参数越界（note 不在 0–127、velocity 不在 1–127）会被忽略；
- 桥是幂等的，重复加载页面不会重复挂载；
- 通道二下网页的设备下拉无硬件可选，属正常现象，映射与判定不受影响。

## 通道三：鼓棒姿态实时显示

网页加载后还会挂载一个鼓棒接口，宿主每帧推送左右鼓棒的角度，网页在鼓阵上层实时画出两根立体鼓棒：

```text
window.__pd2uSticks({ v: 1, l: { p: 12.3, y: -45.6 }, r: { p: -8.1, y: 30.0 } })
```

Unity 侧守卫式注入（接口不存在时 no-op）：

```csharp
webView.EvaluateJavaScript(
  "window.__pd2uSticks ? window.__pd2uSticks({\"v\":1,\"l\":{\"p\":12.3,\"y\":-45.6},\"r\":{\"p\":-8.1,\"y\":30.0}}) : 0");
```

字段：

- `v`：协议版本，当前固定 `1`；
- `l` / `r`：左右鼓棒快照，`null` = 无数据/未连接，网页隐藏该棒；
- `p`：pitch 俯仰角（度），`y`：yaw 偏航角（度）。

映射规则：偏航 −45°…+45° 线性对应鼓阵横向左右边缘，俯仰 −45°…+45° 对应鼓阵纵向下上边缘（抬头往上）。
超过 300 毫秒没有新快照即视为无数据，鼓棒不再绘制。

## 调试打印窗口

游玩画面右下角有「调试日志」按钮，可开关一个浮层小窗，实时打印：硬件 MIDI 敲击/松开、宿主注入的 note-on/off、鼓棒快照（100 毫秒节流）、接口挂载与设备变化。每条带毫秒时间戳，保留最近 200 条，可暂停与清空。
