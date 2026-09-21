/** 各参数的中文说明（问号气泡内容），集中在这里方便调整文案 */
export const HELP: Record<string, string> = {
  // 谱面屏
  song: "五首内置曲目，点一下开始下载伴奏与鼓谱，进度到 100% 即可去「游玩」。",
  difficulty:
    "决定出现哪些鼓件和音符密度：轻松只有军鼓、踩镲和左踏板；入门加右踏板；标准再加吊镲、叮叮镲；困难是全部九件。",
  quality: "画面精细度。自动会在卡顿时自己降档；手机或低配电脑建议选「中」或「低」，画面更流畅。",
  visualMs: "只改变音符看起来到达鼓面的时刻，不影响判定。觉得音符看着偏早/偏晚时微调。",
  judgeMs: "把设备与音频的延迟补回来。如果你明明打准了却总判偏早，就把它调大（默认 -35ms）。",
  calibrate: "节拍器会一直响，跟着敲 8 下，系统自动算出你这台机器的延迟并写入判定偏移。",
  kit: "本地鼓音色，敲击立刻出声。关掉后只听伴奏。",
  kitId: "选择鼓组音色，共 9 套。切换后立刻生效；样本在后台加载，加载完成前先用合成音。",
  speed: "音符下落的快慢，只影响观感和提前预判的时间，不改变歌曲速度。",
  offset: "整首曲子的鼓谱与音频对齐用。音符整体偏早就调正数，偏晚调负数。",
  phase: "小节起点的相位微调，用于鼓谱首拍与歌曲不在同一拍时纠正。",
  metronome: "试听时叠加节拍器，用来确认速度与拍号是否正确。",
  mixer: "四条伴奏轨的音量，100% 就是原始文件音量。鼓轨默认静音，方便你自己打。",
  regenerate: "谱面按歌曲固化，每次进入都一样。点这里会重算一份新的。",

  // 映射屏
  midiDevice: "选择要使用的适配器。选「全部输入」时，任何 MIDI 设备的敲击都会被接收。",
  mapping: "点击鼓盘，再敲一下实体鼓（MIDI Learn），就把这个音符绑到该鼓件上。",

  // 游玩屏
  play: "点开始后有四拍倒计时，然后跟着下落的音符敲击对应鼓件。空格可暂停。",
};

/** 英文说明，键与 HELP 一一对应 */
export const HELP_EN: Record<string, string> = {
  song: "Five built-in songs. Tap one to download its backing tracks and drum chart; at 100% head to Play.",
  difficulty:
    "Controls which pieces appear and how dense the chart is: Easy is snare, hi-hat and held left pedal; Beginner adds the right pedal; Standard adds floor tom, crash and ride; Hard uses all nine pieces.",
  quality:
    "Visual detail. Auto steps down when frames drop; pick Mid or Low on phones and low-end PCs for smoother motion.",
  visualMs:
    "Shifts only when notes appear to reach the pad; judging is unaffected. Nudge it if notes look early or late.",
  judgeMs:
    "Compensates for device and audio latency. If your hits read early even when they feel right, raise it (default -35 ms).",
  calibrate:
    "The metronome keeps clicking; hit along 8 times and your device latency is measured and written into the judging offset.",
  kit: "Local drum sounds trigger the moment you hit. Turn it off to hear only the backing tracks.",
  kitId:
    "Pick one of 9 drum kits. Switching applies instantly; samples load in the background and the synth sound covers until then.",
  speed:
    "How fast notes fall. It only changes readability and reaction time, not the song tempo.",
  offset:
    "Aligns the whole drum chart with the audio. Use a positive value if notes come early, negative if late.",
  phase: "Fine phase nudge for the bar start, when the chart's first beat sits off the song's beat.",
  metronome: "Overlays a metronome while previewing, to confirm tempo and time signature.",
  mixer:
    "Volume of the four backing tracks; 100% is the original file level. The drum track is muted so you can play it.",
  regenerate: "Charts are fixed per song. Tap here to recompute a fresh one.",

  midiDevice:
    "Pick the adapter to use. With All inputs, hits from any MIDI device are accepted.",
  mapping:
    "Tap a pad, then hit the physical drum (MIDI learn) to bind that note to the piece.",

  play:
    "After Start there is a four-beat count-in, then hit the matching piece as notes land. Space pauses.",
};

/** 按当前语言取说明文案 */
export function helpText(key: string, language: string): string {
  const zh = HELP[key];
  if (!zh) return "";
  return localize(language as Language, zh, HELP_EN[key] ?? zh);
}
