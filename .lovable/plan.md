# 教学修正 + 各系统流畅度优化

## 1. 教学里加上节拍器声音
教学画面目前只有音符在落，没有任何节拍声。改为教学练习用的 100 BPM 节拍器跟着教学画面的时钟走：
- 每小节 4 拍，第 1 拍重音，其余轻音（和游玩里的节拍器同一种声音）。
- 进入有练习音符的步骤时自动响，「认识鼓件」和「教学完成」这两步不响。
- 离开教学、切到后台、通过关卡弹出提示时立即停止，不会残留声音。

## 2. 第一页鼓件不再自己闪
「认识鼓件」现在每 0.7 秒自动点亮一个鼓面，像是被敲了。去掉这个自动点亮，只有用户真的敲了鼓才有反馈。讲解的鼓件改用不会被误认成「命中」的方式呈现：该步骤只显示鼓阵，不做任何自动高亮。

## 3. 「离开教学」左侧加鼓音色开关
在教学右上角「离开教学」按钮左边加一个鼓声开关按钮（跟随语言显示中英文），点一下开、再点一下关，和游玩设置里的鼓音色开关是同一个全局设置，互相同步。

## 4. 各系统流畅度检查与优化
苹果偶发比安卓更卡，主要怀疑三点，逐一处理：
- 苹果屏幕像素密度高（3 倍），画面绘制量比安卓大很多。给 iOS 单独限制绘制精度上限，画面观感不变但每帧负担明显下降。
- 声音链路：目前只对安卓锁定了音频采样率，苹果走系统默认。给苹果按其真实输出采样率初始化，避免系统重采样带来的额外延迟；并在首次触摸时完成音频解锁与预热，减少第一批快速敲击的抖动。
- 密集敲击时的同时发声数：苹果上限偏紧会吞音、偏松会卡顿。按平台区分同时发声上限，并让调试量表（IN / LF / AU）继续记录，便于实机复测。

优化完成后在桌面和手机横屏两种窗口下实机跑一遍教学与游玩，确认没有报错、帧率与输入延迟数值正常。

## 技术要点
- `src/taiko/tutorial/TutorialStage.tsx`：删除 `parts` 步骤的 700ms `flashes` 轮询；新增 `Metronome` 实例，`start({ bpm: 100, beatsPerBar: 4, getPositionMs: () => tutorialTimeMs })`，时钟源复用现有 `t0`/`chart.durationMs` 循环，卸载与 `restartKey` 变化时 `stop()`；`showNotes === false` 的步骤不启动。
- `src/taiko/tutorial/TutorialOverlay.tsx`：在 `leave` 按钮左侧加鼓声开关，使用 `loadKitEnabled` / `saveKitEnabled` / `subscribeKitEnabled`，标签走 `tutorialLabels`（`steps.ts` 九语言字典新增 `kitOn` / `kitOff`）。
- `src/taiko/platform.ts` / `src/taiko/perf.ts`：新增 iOS 判定下的 `maxDpr` 上限（high 档 iOS 降到 2 → 1.5，medium 1.5 → 1.25），不改安卓与桌面。
- `src/taiko/metronome.ts`：`createCtx()` 对 iOS 不传 `sampleRate`，保留 `latencyHint: "interactive"`；新增一次性 `unlockAudio()` 在首个 touch/pointer 事件恢复 context 并播放静音缓冲。
- `src/taiko/drumKit.ts`：`MAX_VOICES_PER_PART` / `MAX_VOICES_TOTAL` 按平台取值（iOS 3/12、安卓 3/14、桌面 4/16），预热逻辑复用现有 kit 预热。
- 验证：`bunx tsgo --noEmit`、构建、Playwright 桌面 1280×700 与手机横屏 920×430 截图 + console 检查。

## 交付
打包改动文件为 zip 放到 Files，附文件清单；本地解压覆盖后照常执行 `bun install` → `bun run electron:rebuild:asio` → `bun run electron:pack:win`。
