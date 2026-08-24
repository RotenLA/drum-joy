/**
 * 音频元数据：手写轻量 ID3v2 解析，读取 TBPM（BPM）/ TSIG（拍号）/ TIT2（标题）。
 * wav 与无标签的 mp3 读不到时返回空对象，由调用方走自动检测。
 */

export interface AudioMeta {
  bpm?: number;
  timeSignature?: [number, number];
  title?: string;
}

/** ID3 的 synchsafe 整数（每字节 7 位） */
function synchsafe(dv: DataView, pos: number): number {
  return (
    ((dv.getUint8(pos) & 0x7f) << 21) |
    ((dv.getUint8(pos + 1) & 0x7f) << 14) |
    ((dv.getUint8(pos + 2) & 0x7f) << 7) |
    (dv.getUint8(pos + 3) & 0x7f)
  );
}

/** 文本帧解码：首字节为编码标记（0 latin1 / 1 UTF-16 BOM / 2 UTF-16BE / 3 UTF-8） */
function decodeTextFrame(dv: DataView, pos: number, size: number): string {
  if (size <= 1) return "";
  const enc = dv.getUint8(pos);
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + pos + 1, size - 1);
  try {
    if (enc === 0) return new TextDecoder("iso-8859-1").decode(bytes).replace(/\0+$/, "");
    if (enc === 1) return new TextDecoder("utf-16").decode(bytes).replace(/\0+$/, "");
    if (enc === 2) return new TextDecoder("utf-16be").decode(bytes).replace(/\0+$/, "");
    return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/, "");
  } catch {
    return "";
  }
}

export function parseAudioMeta(buf: ArrayBuffer): AudioMeta {
  const out: AudioMeta = {};
  const dv = new DataView(buf);
  if (dv.byteLength < 10) return out;
  // "ID3"
  if (dv.getUint8(0) !== 0x49 || dv.getUint8(1) !== 0x44 || dv.getUint8(2) !== 0x33) {
    return out;
  }
  const major = dv.getUint8(3);
  if (major < 3) return out; // v2.2 及以下不解析（罕见）
  const flags = dv.getUint8(5);
  const tagSize = synchsafe(dv, 6);
  const end = Math.min(10 + tagSize, dv.byteLength);
  let pos = 10;

  // 扩展头
  if (flags & 0x40) {
    if (major === 3) pos += 4 + dv.getUint32(pos);
    else pos += 4 + synchsafe(dv, pos);
  }

  while (pos + 10 <= end) {
    const id = String.fromCharCode(
      dv.getUint8(pos),
      dv.getUint8(pos + 1),
      dv.getUint8(pos + 2),
      dv.getUint8(pos + 3),
    );
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const frameSize = major === 4 ? synchsafe(dv, pos + 4) : dv.getUint32(pos + 4);
    const dataPos = pos + 10;
    if (frameSize <= 0 || dataPos + frameSize > dv.byteLength) break;

    if (id === "TBPM" || id === "TSIG" || id === "TIT2") {
      const text = decodeTextFrame(dv, dataPos, frameSize).trim();
      if (id === "TBPM") {
        const b = Number.parseFloat(text);
        if (Number.isFinite(b) && b > 0) out.bpm = Math.round(b * 10) / 10;
      } else if (id === "TSIG") {
        const m = text.match(/^(\d+)\s*\/\s*(\d+)/);
        if (m) out.timeSignature = [Number(m[1]), Number(m[2])];
      } else if (text) {
        out.title = text;
      }
    }
    pos = dataPos + frameSize;
  }
  return out;
}
