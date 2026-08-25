/**
 * 速度/拍号自动检测（纯 TS，无依赖）：
 * 频谱通量 onset 包络 + 自相关估 BPM（含折半/翻倍校正），
 * 节拍网格相位扫描估首拍偏移；拍号在 2/4、3/4、4/4、6/8 中
 * 按重音周期分类，置信度低时默认 4/4。
 *
 * 启发式：BPM 通常准，拍号与偏移可能偏差，界面始终允许手动修改。
 */

export interface BeatDetectResult {
  bpm: number;
  /** 首拍偏移（毫秒） */
  offsetMs: number;
  timeSignature: [number, number];
  /** 拍号置信度 0-1，低时界面提示手动确认 */
  tsConfidence: number;
}

const SR = 11025;
const FFT_SIZE = 1024;
const HOP = 512;

const yieldMain = () => new Promise<void>((r) => setTimeout(r, 0));

/** 简易迭代基2 FFT（就地） */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j]!;
        const ui = im[i + j]!;
        const vr = re[i + j + half]! * cwr - im[i + j + half]! * cwi;
        const vi = re[i + j + half]! * cwi + im[i + j + half]! * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

/** 线性插值采样包络 */
function sample(env: Float32Array, idx: number): number {
  const i = Math.floor(idx);
  if (i < 0 || i >= env.length - 1) return env[Math.max(0, Math.min(env.length - 1, i))] ?? 0;
  const frac = idx - i;
  return (env[i] ?? 0) * (1 - frac) + (env[i + 1] ?? 0) * frac;
}

export async function detectBeat(buffer: AudioBuffer): Promise<BeatDetectResult> {
  // 1. 单声道混音 + 抽取到 11025Hz
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const ratio = buffer.sampleRate / SR;
  const len = Math.floor(buffer.length / ratio);
  const pcm = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.min(buffer.length - 1, Math.floor(i * ratio));
    pcm[i] = ch1 ? (ch0[s]! + ch1[s]!) / 2 : ch0[s]!;
  }

  // 2. STFT 频谱通量 onset 包络
  const hopMs = (HOP / SR) * 1000; // ≈46.4ms
  const frameCount = Math.max(1, Math.floor((len - FFT_SIZE) / HOP));
  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)); // Hann
  }
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const prevMag = new Float32Array(FFT_SIZE / 2);
  const env = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const base = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (pcm[base + i] ?? 0) * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let i = 0; i < FFT_SIZE / 2; i++) {
      const m = Math.hypot(re[i]!, im[i]!);
      const d = m - prevMag[i]!;
      if (d > 0) flux += d;
      prevMag[i] = m;
    }
    env[f] = flux;
    if (f % 400 === 399) await yieldMain();
  }

  // 去局部均值（滑动窗口 ~1s）
  const meanWin = 21;
  for (let i = 0; i < frameCount; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - meanWin); j <= Math.min(frameCount - 1, i + meanWin); j++) {
      s += env[j]!;
      c++;
    }
    env[i] = Math.max(0, env[i]! - s / c);
  }

  // 3. 自相关估 tempo（50–240 BPM 搜索，带 120 BPM 弱先验）
  const minLag = Math.max(2, Math.round(60000 / 240 / hopMs));
  const maxLag = Math.min(frameCount >> 1, Math.round(60000 / 50 / hopMs));
  let bestLag = minLag;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frameCount; i++) s += env[i]! * env[i + lag]!;
    const bpm = 60000 / (lag * hopMs);
    s *= 1 - Math.min(0.3, Math.abs(bpm - 120) / 600);
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  let bpm = 60000 / (bestLag * hopMs);
  while (bpm < 80) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  // 3b. 细分自相关精修 tempo：粗估 lag ±1.5% 内按 0.005 帧步进扫描
  // （线性插值采样包络）。整数帧分辨率带来 ±1% 级误差，反映在 16 分
  // 网格上是随时间累积的漂移（60s 处可达数百毫秒），必须压到 ~0.05%。
  {
    const lo = bestLag * (1 - 0.015);
    const hi = bestLag * (1 + 0.015);
    let fineLag = bestLag;
    let fineScore = -1;
    for (let lag = lo; lag <= hi; lag += 0.005) {
      let s = 0;
      for (let i = 0; i + lag < frameCount; i++) s += env[i]! * sample(env, i + lag);
      if (s > fineScore) {
        fineScore = s;
        fineLag = lag;
      }
    }
    let fineBpm = 60000 / (fineLag * hopMs);
    while (fineBpm < 80) fineBpm *= 2;
    while (fineBpm > 180) fineBpm /= 2;
    bpm = fineBpm;
  }
  bpm = Math.round(bpm * 100) / 100;

  // 4. 相位扫描估首拍偏移（只扫前 30 秒加速）
  const beatMs = 60000 / bpm;
  const beatFrames = beatMs / hopMs;
  const scanLen = Math.min(frameCount, Math.floor(30000 / hopMs));
  const phases = 24;
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let p = 0; p < phases; p++) {
    const phase = (p / phases) * beatFrames;
    let s = 0;
    for (let b = phase; b < scanLen; b += beatFrames) s += sample(env, b);
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = p;
    }
  }
  const offsetMs = Math.round((bestPhase / phases) * beatMs);

  // 5. 拍号：拍点强度序列的重音周期
  const startFrame = (bestPhase / phases) * beatFrames;
  const beatCount = Math.floor((scanLen - startFrame) / beatFrames);
  const bs: number[] = [];
  for (let i = 0; i < beatCount; i++) bs.push(sample(env, startFrame + i * beatFrames));

  const accentScore = (k: number): number => {
    let hi = 0, hn = 0, lo = 0, ln = 0;
    for (let i = 0; i < bs.length; i++) {
      if (i % k === 0) {
        hi += bs[i]!;
        hn++;
      } else {
        lo += bs[i]!;
        ln++;
      }
    }
    return hn > 0 && ln > 0 ? hi / hn - lo / ln : 0;
  };

  // 6/8：以八分音符为步进（拍长一半），每 6 步内 0 强 3 次强
  const bs8: number[] = [];
  for (let i = 0; i < beatCount * 2; i++) bs8.push(sample(env, startFrame + (i * beatFrames) / 2));
  const score68 = (): number => {
    let strong = 0, sn = 0, sub = 0, sbn = 0, weak = 0, wn = 0;
    for (let i = 0; i + 6 <= bs8.length; i += 6) {
      strong += bs8[i]!;
      sn++;
      sub += bs8[i + 3]!;
      sbn++;
      weak += bs8[i + 1]! + bs8[i + 2]! + bs8[i + 4]! + bs8[i + 5]!;
      wn += 4;
    }
    if (!sn || !wn) return 0;
    return (strong / sn + 0.7 * (sub / sbn)) / 1.7 - weak / wn;
  };

  const candidates: { ts: [number, number]; score: number }[] = [
    { ts: [2, 4], score: accentScore(2) },
    { ts: [3, 4], score: accentScore(3) },
    { ts: [4, 4], score: accentScore(4) },
    { ts: [6, 8], score: score68() },
  ];
  candidates.sort((a, b) => b.score - a.score);
  // 非 4/4 保守化：流行/摇滚绝大多数是 4/4；拍号错会让小节网格错位、
  // 节奏聚类碎片化。非 4/4 候选需领先 4/4 ≥35% 才采纳，否则回退 4/4。
  const c44 = candidates.find((c) => c.ts[0] === 4 && c.ts[1] === 4)!;
  let top = candidates[0]!;
  if (top !== c44) {
    const margin = top.score > 0 ? (top.score - c44.score) / top.score : 0;
    if (margin < 0.35) top = c44;
  }
  // 置信度：与次优者的相对差距；过低默认 4/4
  const second = candidates.find((c) => c !== top)!;
  const confidence =
    top.score > 0 ? Math.max(0, Math.min(1, (top.score - second.score) / top.score + 0.3)) : 0;
  const timeSignature: [number, number] =
    top.score <= 0 || confidence < 0.25 ? [4, 4] : top.ts;

  return { bpm, offsetMs, timeSignature, tsConfidence: Math.round(confidence * 100) / 100 };
}
