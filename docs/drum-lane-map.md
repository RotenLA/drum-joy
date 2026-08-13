# 太鼓「咚 / 嗒」音符映射表

分组原则：**双脚 = 咚（DON，红）**，**双手 = 嗒（KA，蓝）**。

## 咚（DON / 红）

| 音符 | 鼓件 |
| --- | --- |
| 36 | 底鼓 Bass Drum 1 |
| 44 | 踩镲踏板 Pedal Hi-Hat |

## 嗒（KA / 蓝）

| 音符 | 鼓件 |
| --- | --- |
| 35 | 原声底鼓 Acoustic Bass Drum |
| 38 | 军鼓 Acoustic Snare |
| 40 | 电军鼓 Electric Snare |
| 41 | 低落地嗵 Low Floor Tom |
| 42 | 闭踩镲 Closed Hi-Hat |
| 43 | 高落地嗵 High Floor Tom |
| 45 | 低嗵 Low Tom |
| 46 | 开踩镲 Open Hi-Hat |
| 47 | 低中嗵 Low-Mid Tom |
| 48 | 高中嗵 Hi-Mid Tom |
| 49 | 强音镲 Crash Cymbal 1 |
| 50 | 高嗵 High Tom |
| 51 | 叮叮镲 Ride Cymbal 1 |
| 52 | 中国镲 Chinese Cymbal |

## 约定

- 未在上表出现的任何音符，`getDrumLane()` 返回 `null`，调用方直接忽略，不生成谱面音符。
- 本表为默认值。后续如支持用户自定义，应在此模块之上叠加覆盖层，核心表保持不变。
- 35 号（原声底鼓）虽是底鼓家族，但空气鼓踏板实际只发 36；35 若出现按手击处理，归入嗒。

## API

```ts
import { getDrumLane, isChartNote, getDrumNoteName } from "@/shared/drumLaneMap";

getDrumLane(36); // 'don'
getDrumLane(51); // 'ka'
getDrumLane(60); // null
```
