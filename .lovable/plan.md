# 输出 Unity C# 复刻版源码包

## 目标
把网页版 PD2U 空气鼓模块的完整玩法逻辑翻译成 Unity C# 源码，交给 Unity 同事拷进工程即可复刻出与网页版一致的游戏：3D 场景画面、Unity 端解析 MIDI 实时编谱、Unity 原生读 MIDI。

## 交付形态
- 一个 zip 放 /mnt/documents/，按 `Assets/PD2U/Scripts/...` 目录组织，附 README 接入说明
- 纯 C#，不依赖第三方包（MIDI 硬件读取留标准接口，同事接自己的原生插件）
- 不改现有网页项目任何文件

## 代码模块（与网页版一一对应）

```text
Assets/PD2U/
├── README.md                     接入步骤、场景搭建清单、参数对照表
├── Scripts/
│   ├── Midi/
│   │   ├── MidiFile.cs           SMF 0/1 解析：tempo map、拍号、note 事件（译自 midiFile.ts）
│   │   ├── MidiChartCleaner.cs   去鼓轨清理（译自 midiClean.ts）
│   │   └── IMidiInput.cs         原生 MIDI 输入接口：OnNoteOn(note, vel, hostTimeMs) / OnNoteOff
│   ├── Chart/
│   │   ├── DrumLaneMap.cs        GM 鼓件→9 部件映射表（译自 drumLaneMap.ts）
│   │   ├── LaneLayouts.cs        分区定义、PAD_ANCHORS 摆位、鼓件色值（译自 laneLayouts.ts）
│   │   ├── Difficulty.cs         四档难度编谱：轻松/入门/标准/困难全部规则（译自 difficulty.ts）
│   │   └── TaikoChart.cs         谱面数据结构、shiftChart 开头空白平移
│   ├── Play/
│   │   ├── StageBuilder.cs       3D 场景生成：扇形鼓盘阵、车道、消失点、相机机位（译自 stageRenderer 几何）
│   │   ├── NoteSpawner.cs        音符生成/回收、下落运动、缩圈提示、同刻淡连线
│   │   ├── Judge.cs              判定：PERFECT 100ms / GOOD 200ms、长音符全程按住、连击计分
│   │   ├── SongPlayer.cs         绝对起播时刻、leadMs 跳过空白、视觉/判定偏移（0 / -35ms）
│   │   └── DrumSynth.cs          内置合成鼓音色（可开关，与网页同参数）
│   ├── Sticks/
│   │   ├── StickView.cs          两根 3D 鼓棒，pitch/yaw 驱动，约现有一半大小
│   │   ├── StickCalibration.cs   校准文件读写 + 最近鼓面柔和吸附（18° 自由 / 4° 吸附 / 滞环）
│   │   └── PositionCapture.cs    位置捕捉流程状态机（7 面 × 左右手 × 3 次，中位数摘要）
│   └── Ui/
│       ├── FpsBadge.cs           演奏帧数显示
│       └── QualityGovernor.cs    三档画质 + 自动降档（对应 perf.ts 策略）
└── Scenes/PD2U_Demo.unity 说明   README 内给出搭建步骤（无法离线生成 .unity 二进制）
```

## 关键规则原样保留
- 咚 = note 36/44，嗒 = 其余；判定 PERFECT 100ms / GOOD 200ms；校准初值 视觉 0 / 判定 -35ms
- 四档难度部件集与互斥规则（踩镲与低通/吊镲/叮叮镲不同刻等）逐条翻译
- 开头空白 -24dB 阈值裁剪由调用方传入 leadMs（Unity 侧音频裁剪接口留在 README）
- 鼓盘摆位、色值直接取 laneLayouts.ts 的常量表，README 附对照

## 验证
- 沙箱内无法跑 Unity，只做 C# 语法级自检（dotnet/mcs 若可用）+ 与网页版常量的逐项对照
- README 写明同事的验收路径：导入 → 建场景 → 挂 StageBuilder → 选 MIDI → 应看到与网页一致的鼓阵与谱面

## 交付
zip + 文件清单 txt 放 /mnt/documents/，回复附简短说明。
