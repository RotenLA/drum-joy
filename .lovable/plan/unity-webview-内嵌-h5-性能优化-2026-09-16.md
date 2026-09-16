# Unity WebView 内嵌 H5 性能优化

目标：在 Unity 以 H5(WebView) 形式嵌入时，进一步压低每帧开销与峰值卡顿，尤其是中低端安卓 WebView（GPU 弱、单通道内存、易被系统限帧）。

现有基础（已具备，不重做）：画质三档 + auto 自动降档、DPR 截断、30/60 帧上限、GLOW 开关。

## 优化点

1. **静态背景离屏缓存（收益最大）**
   - 舞台背景（天空/地面渐变、网格、聚光、边缘暗角）目前每帧全量重画。改为 OffscreenCanvas/离屏 canvas 预渲染一次，仅当尺寸或画质档变化时重渲，每帧 `drawImage` 贴回。

2. **渐变与样式对象缓存**
   - 鼓盘侧面/顶面、长音符色带等 `createLinearGradient/createRadialGradient` 每帧新建，改为按（尺寸+档位）缓存复用，减少 GC 压力（WebView 上 GC 卡顿明显）。

3. **判定/连击等 HUD 更新节流**
   - 游玩页顶部的判定文字、连击数每帧 setState 会触发 React 重渲染。改为仅在数值变化时更新，或移出 React 由渲染器直接绘制到 canvas。

4. **页面不可见时停帧静音**
   - 监听 `visibilitychange`：Unity 把 H5 切后台/锁屏时暂停 rAF 绘制循环与节拍器/鼓音色，回前台恢复；避免后台空转耗电、回前台时音频时钟追帧爆音。

5. **图片资源预解码**
   - 封面/鼓位图等用 `img.decode()` 或 `createImageBitmap` 预解码后再进入游玩，避免首次绘制时的解码卡顿。

6. **WebView 环境初始档位**
   - 检测到运行在 Unity WebView（UserAgent 含 wv / Unity 注入标记，或 `window.__pd2uNoteOn` bridge 存在）时，auto 模式初始档从「中」起步而不是「高」，减少开局降档期的掉帧。

7. **绘制调用收敛（小项）**
   - 同色同透明度的连线/缩圈合并路径一次性 stroke；减少每帧 `save/restore` 嵌套层数。

## 不做

- 不改音频引擎架构（现有 gain 节点链已很轻）；不引入 WebGL/WebGPU 重写渲染器（改动大、收益不成比例）。

## 技术说明

- 改动集中在 `src/taiko/stageRenderer.ts`（背景缓存、渐变缓存、路径合并）、`src/taiko/FallScreen.tsx` 与 `tutorial/TutorialStage.tsx`（visibilitychange 停帧、HUD 节流）、`src/taiko/perf.ts`（WebView 初始档）。
- 验证：tsgo 通过；Playwright 走教学+游玩流程无报错；打包 zip 交付。
