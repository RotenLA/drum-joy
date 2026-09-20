# 输出《Unity ↔ Web 对接 API 文档》

## 背景
Unity 同事不开发网页业务，只需要一份正式、完整、可直接照着接入的「Unity ↔ Web 对接 API」文档。现有 `docs/unity-midi-bridge.md` 内容零散（夹杂历史方案），需整理成一份规范的接口文档。

## 产出
一份文档（Markdown 源文件 + PDF 各一，放 /mnt/documents/），不改动项目代码。

## 文档结构

```text
PD2U Web ↔ Unity 对接 API
1. 概述与架构图
   - 网页运行在 Unity 内嵌 WebView（Vuplex / CEF / 系统 WebView）
   - 三条通道：网页直读 Web MIDI / Unity 原生读 MIDI 注入 / 鼓棒姿态注入
2. 环境要求
   - WebView 硬件加速、不透明叠加、尺寸按实际像素
   - Chromium 内核需放行 midi 权限（含 CEF OnPermissionRequest 处理）
3. API 一览表（速查）
4. API 详细定义
   4.1 window.__pd2uNoteOn(note, velocity, hostTimeMs?)
       - 参数范围、非法值忽略、hostTimeMs 时钟对齐规则（偏差>1s 自动重对齐）
   4.2 window.__pd2uNoteOff(note)
       - 长音符判定依赖、0x80 与 0x90 vel=0 两种来源
   4.3 window.__pd2uSticks(snapshot)
       - JSON 协议 v1：l/r 可 null、p/y 角度范围、>300ms 无数据隐藏
       - 角度→鼓面映射规则（偏航 ±45°→横向，俯仰 ±45°→纵向）
       - 推送频率建议（≤60 次/秒，跟随显示帧率）
   4.4 生命周期与幂等性
       - 页面加载即挂载、重复注入 no-op、守卫式调用写法（C# 示例片段）
5. 用户侧设置对输入的影响
   - 部件映射（默认 36/44 等，用户可改）、视觉/判定偏移、自动校准、内置鼓声开关
6. 性能约定
   - 三档画质与自动降档行为、WebView 环境下的降档起点
   - 宿主侧注意事项清单
7. 调试手段
   - 游玩页右下角调试日志浮层：注入事件/鼓棒快照/设备变化全量可见
8. 常见问题
   - 系统 WebView 无 Web MIDI 属正常（走注入通道）
   - 安卓 Unity 上下滑动、页面叠加等已知注意事项
9. 版本与变更记录
```

## 关键内容来源
- `docs/unity-midi-bridge.md`（现有协议描述）
- `src/taiko/midiInput.ts`（__pd2uNoteOn/__pd2uNoteOff 实际行为与校验规则）
- `src/taiko/stickInput.ts`（__pd2uSticks 协议）
- `src/taiko/perf.ts`（画质档位）

## 验证
- 文档中每个接口行为与源码逐项核对，不写与实现不符的内容
- PDF 生成后逐页转图检查排版

## 交付
- `pd2u-unity-web-api.md` + `pd2u-unity-web-api.pdf` 放 /mnt/documents/
