# 安卓外壳（Unity / WebView）必改清单

网页端已经做完能做的减负（发声数量上限、自适应发声提前量、击打时间戳、
演奏中申请屏幕常亮、只保留当前鼓组采样）。下面这几项只能在安卓宿主侧设置，
否则中低端机长时间运行仍可能被系统强制回收。

## 1. 不被系统杀掉

- 播放期间使用前台服务（带常驻通知），不要只靠 Activity 存活。
- `onTrimMemory` / `onLowMemory` 回调里**不要**销毁 WebView 或整个网页层，
  只释放自己的纹理与缓存；WebView 被销毁后网页状态会全部丢失。
- Activity 加 `FLAG_KEEP_SCREEN_ON`（或 Unity 的 `Screen.sleepTimeout = NeverSleep`），
  网页侧的 Wake Lock 在部分 WebView 上不可用。
- 关闭厂商省电/后台限制引导（首次进入提示用户把 App 加入电池优化白名单）。
- 不要在演奏中做大块内存分配（贴图加载、录屏），容易触发系统回收。

## 2. WebView 设置

```java
WebSettings s = webView.getSettings();
s.setJavaScriptEnabled(true);
s.setDomStorageEnabled(true);
s.setDatabaseEnabled(true);
s.setMediaPlaybackRequiresUserGesture(false);
webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
```

- Android System WebView / Chrome 最低要求 ≥ 90，并建议保持为应用商店最新版。
- 开启硬件加速（Application 与 Activity 都不要设 `hardwareAccelerated=false`）。
- 允许自动播放媒体，否则倒计时与歌曲首次播放会被拦。

## 3. 击打事件传输

- `window.__pd2uNoteOn(note, velocity, hostTimeMs)` 请**始终带上第三个参数**，
  用采集到击打的那一刻的宿主时间戳（毫秒）。
- 一批多个击打请逐条调用，每条带自己的时间戳，不要合并成同一时刻。
- 不要把击打事件排队等下一帧再发；采集到即发。
- 网页侧对迟到超过 400ms 的击打只出声不判定，避免错误命中。

## 4. 息屏 / 切后台

- 切后台或息屏时网页会自动暂停，回前台保持暂停等用户确认，不自动续播。
- 若宿主真的被回收过一次，重新加载网页会回到选歌页，这是预期行为。

## 5. 自检

演奏中打开画布右下角「调试日志」，左上角会出现：

- `IN a/b ms`：击打从宿主到网页的延迟（当前/最近 50 次最大）。偏大说明宿主侧就晚了。
- `LF n (x ms)`：长帧次数与最近耗时。变大说明网页/GPU 卡。
- `AU n / x ms`：当前同时发声数与发声提前量。发声数长期贴上限说明音色层压力大。
