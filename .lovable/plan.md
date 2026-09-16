# 删歌、教学鼓声开关、淡连线、缩圈更明显

## 1. 删除 Rolling in the Deep

- 预设曲列表移除这首歌，只剩红色高跟鞋、李白、As Long As You Love Me、Creepin' Up On You 四首。
- 一并删掉它的音频/MIDI 资源引用，避免仍被打包下载。
- 之前为它做的通用过门判定修正保留不变（对其他歌同样有效）。

## 2. 教学里也能开关本地鼓声

- 教学画面加一个「鼓音色 开/关」小按钮，位置在教学舞台角落，样式低调。
- 与谱面页全局参数里的同一个开关共用同一份存档，任一处切换另一处立刻同步（不用重进页面）。
- 教学练习中的击打声即时跟随开关，关闭后只保留节拍器。

## 3. 同时刻音符的连线加回来（很淡）

- 同一时刻（±15ms 容差）出现的两个及以上音符之间，重新画一条连线，帮助判断"要一起敲"。
- 视觉刻意压低：细线、低透明度、几乎无泛光；越靠近判定位置略微变亮一点，但始终淡于音符本身。
- 只在舞台下落绘制，教学与正式游玩共用同一份绘制，因此两处一致。

## 4. 缩圈提示稍微加大、稍明显

- 起始圈略放大（外扩幅度从约 1.42 倍提到约 1.55 倍），收缩行程更长一点，更容易被注意到。
- 峰值透明度从约 0.38 提到约 0.55，描边略加粗，泛光仍保持很弱。
- 形状、角度、出现时机、长音符只提示踩下时刻等规则不变，依旧不抢过音符。

## 技术说明

- `src/taiko/presetSongs.ts`：删除该曲条目与 5 个资源导入。
- `src/taiko/drumKit.ts`：增加 `subscribeKitEnabled` 订阅（saveKitEnabled 时广播），供教学与全局参数共享状态。
- `src/taiko/tutorial/TutorialStage.tsx`：`kitOn` 改为可变 ref + 订阅；`src/taiko/tutorial/TutorialOverlay.tsx` 增加开关按钮；`src/taiko/GlobalSettings.tsx` 改为读订阅值。
- `src/taiko/stageRenderer.ts`：新增 `CHORD_TOL_MS` 与同刻分组连线绘制项（在鼓盘之后、音符之前绘制）；调整 `drawCueOutline` 的 scale/alpha/lineWidth 常量。

## 交付

改动源码按原目录结构打包 zip 放 `/mnt/documents/`，附文件清单；本地解压后照常运行三个 bun 步骤。
