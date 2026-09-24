# 设置面板去重 + 教学踩镲/踏板同时触发

## 一、设置弹窗只保留真正的全局项

歌曲卡片里已有：难度、下落速度、手机音色开关、鼓组选择、下落模式。设置弹窗里重复的全部移除。

- `src/taiko/GlobalSettings.tsx`
  - 删除：难度按钮组、下落速度按钮组、手机音色开关+?、鼓组下拉+?
  - 保留：画质、音符视觉偏移、判定偏移、自动校准（及其 ? 说明）
  - 移除不再使用的导入（DIFFICULTIES、KIT_NAMES、drumKit 相关、HelpDot 中 kit/kitId/difficulty/speed 引用、SPEEDS 常量等），`speed`/`onSpeedChange`/`fallMode`/`onFallModeChange` 属性一并删除
  - 顶部注释同步更新
- 调用处（ChartScreen.tsx 等）改为 `<GlobalSettings />`，不再传已删属性
- 卡片内的 CardControls 保持不变（唯一入口）

设置弹窗最终内容：
```text
全局参数 | 所有歌曲通用
画质: 自动 高 中 低 (当前实际…)
音符视觉偏移 [滑杆]  判定偏移 [滑杆]
[自动校准] ?
```

## 二、教学"踏板与踩镲"改为同时触发

- `src/taiko/tutorial/practiceChart.ts`：combo 课且含 pedalHat 时，为每个闭镲音符在同一 timeMs 生成左踏板短音符（无 holdMs），两者并排同时到达判定线（舞台/横排一致）
- `src/taiko/tutorial/TutorialOverlay.tsx`：该课判定改为"同一时刻闭镲和左踏板都在 200ms 窗口内命中"才计 1 次，consumedRef 防重复，连续正确 8 次通过
- `src/taiko/tutorial/steps.ts`：该步九语言文案改为"左踏板与闭镲同时敲击"语义
- 左踏板长音符仍只保留在"踩住长音符"专属课

## 验证与交付

- tsgo 类型检查通过
- 打包 ZIP 到 /mnt/documents/，附 FILES.txt 文件清单
