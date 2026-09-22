# 教学舞台与正式游戏完全一致

## 问题

教学里的鼓面是另写的一套：用 HTML 图片按百分比摆放（`TutorialStage.tsx` 里的 `POS` 表），音符是一个 CSS 动画的小圆点从顶部中间掉下来。正式游戏用的是画布渲染器（扇形鼓盘阵、18:9 构图、辐射车道、由小变大的音符、缩圈提示、命中闪光、火花）。两套东西的大小、位置、角度、下落方式都不一样，所以教学学到的位置感在正式游戏里对不上。

## 做法

教学不再自己画鼓，直接复用正式游戏那一套渲染。教学画面变成一块和游玩一样的画布：

- 鼓盘阵、摆位、角度、颜色、命中发光、背景全部来自正式渲染器，不额外写坐标。
- 教学的练习音符变成真正的谱面音符：按 100 BPM 生成一小段循环练习谱，走正式游戏同一条车道、同一段飞行时间、同一个缩圈提示，落到对应鼓面上。
- 长踩练习（左踏板踩住）也用正式游戏的长音符色带表现，而不是一个圆点。
- 「认识鼓件」这一步只显示鼓阵、不落音符，同时依次高亮讲解到的鼓件（用正式渲染器的命中高亮，不再用缩放+滤镜）。
- 敲对了仍然按现在的规则累计次数、通过、下一步；右上角「离开教学」、右侧说明栏布局不变。
- 教学画布同样按 18:9 居中，在手机横屏窄窗口里和游玩画面构图一致。
- 教学里隐藏分数/连击/血条等比赛信息，只保留必要的进度提示，避免干扰讲解。

## 技术要点

- 重写 `src/taiko/tutorial/TutorialStage.tsx`：改为 `<canvas>` + rAF，调用 `renderStage(ctx, w, h, frame)`；删除 `POS`、`SPRITES` 与 CSS 音符。
- 帧数据用 `StageFrame`：`chart` 为新建的教学练习谱（`TaikoChart`，bpm 100、4/4、按步骤 `targets` 循环生成 `notes`，长踩步骤带 `holdMs`），`timeMs` 由教学内部时钟推进并循环，`speed` 用全局设置速度以外的固定 1.0，`showNotes` 在「认识鼓件」步为 false，`parts` 传该步涉及鼓件或全部 9 件。
- HUD 精简：`score/combo` 传 0、`stats`/`hp` 不传；沿用 `drawHud` 时不再显示歌名（教学谱 `title` 用步骤标题）。
- 新增 `src/taiko/tutorial/practiceChart.ts`：由 `step.targets` + `needed` 生成循环练习谱（含音符对应的 `note` 号，取自 `laneLayouts` 的分区映射，保证落到正确鼓面）。
- `TutorialOverlay.tsx`：把 hitPart/held/progress 改为传给画布的 flashes（`Record<PartId, number>` 到期时间戳）与步骤信息；判定逻辑（MIDI onNote/onNoteOff、4800ms 长踩）保持不动。
- `styles.css` 中 `taiko-tutorial-note` 动画随之删除。

## 验证

- 类型检查 + 构建。
- 用 Playwright 在桌面和手机横屏各截图教学各步骤与正式游玩画面，逐张比对鼓面大小位置一致。
- 模拟 MIDI 输入走完 8 步，确认计数、长踩、跳过、离开教学都正常。
- 完成后打包 zip 放到 Files，附文件清单。
