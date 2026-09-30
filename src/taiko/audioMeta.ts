/**
 * 原曲文件内嵌信息读取：歌名、歌手、专辑封面。
 * 支持 ID3v2（mp3、部分 flac 外壳）与 FLAC 原生 VORBIS_COMMENT / PICTURE 块。
 * 纯前端解析，不依赖任何库。
 */

export interface AudioMeta {
  title: string | null;
  artist: string | null;
  cover: { blob: Blob; ext: string } | null;
}

const EMPTY: AudioMeta = { title: null, artist: null, cover: null };

const ascii = (view: Uint8Array, at: number, len: number): string =>
  String.fromCharCode(...view.subarray(at, at + len));

const extOfMime = (mime: string): string => {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
};

/** 复制成独立的 ArrayBuffer，避免视图类型与 Blob 参数不兼容 */
const toBlobPart = (view: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(view.length);
  copy.set(view);
  return copy.buffer;
};


/** ID3v2 文本帧解码（0=Latin1 1=UTF16LE/BE 2=UTF16BE 3=UTF8） */
function decodeText(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const encoding = bytes[0]!;
  const body = bytes.subarray(1);
  try {
    if (encoding === 0) return new TextDecoder("windows-1252").decode(body).replace(/\0+$/, "");
    if (encoding === 3) return new TextDecoder("utf-8").decode(body).replace(/\0+$/, "");
    if (encoding === 2) return new TextDecoder("utf-16be").decode(body).replace(/\0+$/, "");
    // 1: 带 BOM 的 UTF-16
    const be = body[0] === 0xfe && body[1] === 0xff;
    return new TextDecoder(be ? "utf-16be" : "utf-16le")
      .decode(body.subarray(2))
      .replace(/\0+$/, "");
  } catch {
    return "";
  }
}

function parseId3(data: Uint8Array): AudioMeta | null {
  if (data.length < 10 || ascii(data, 0, 3) !== "ID3") return null;
  const major = data[3]!;
  const size =
    ((data[6]! & 0x7f) << 21) | ((data[7]! & 0x7f) << 14) | ((data[8]! & 0x7f) << 7) | (data[9]! & 0x7f);
  const end = Math.min(data.length, 10 + size);
  const frameIdLen = major === 2 ? 3 : 4;
  let at = 10;
  const out: AudioMeta = { title: null, artist: null, cover: null };

  while (at + frameIdLen + (major === 2 ? 3 : 6) <= end) {
    const id = ascii(data, at, frameIdLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let frameSize: number;
    let headerLen: number;
    if (major === 2) {
      frameSize = (data[at + 3]! << 16) | (data[at + 4]! << 8) | data[at + 5]!;
      headerLen = 6;
    } else if (major === 4) {
      frameSize =
        ((data[at + 4]! & 0x7f) << 21) |
        ((data[at + 5]! & 0x7f) << 14) |
        ((data[at + 6]! & 0x7f) << 7) |
        (data[at + 7]! & 0x7f);
      headerLen = 10;
    } else {
      frameSize =
        (data[at + 4]! << 24) | (data[at + 5]! << 16) | (data[at + 6]! << 8) | data[at + 7]!;
      headerLen = 10;
    }
    if (frameSize <= 0 || at + headerLen + frameSize > end) break;
    const body = data.subarray(at + headerLen, at + headerLen + frameSize);

    if (id === "TIT2" || id === "TT2") out.title ||= decodeText(body).trim() || null;
    else if (id === "TPE1" || id === "TP1") out.artist ||= decodeText(body).trim() || null;
    else if ((id === "APIC" || id === "PIC") && !out.cover) {
      let p = 1; // 跳过编码字节
      let mime = "image/jpeg";
      if (id === "PIC") {
        mime = `image/${ascii(body, 1, 3).toLowerCase()}`;
        p = 4;
      } else {
        let zero = p;
        while (zero < body.length && body[zero] !== 0) zero++;
        mime = ascii(body, p, zero - p) || "image/jpeg";
        p = zero + 1;
      }
      p += 1; // picture type
      // 描述串（按文本编码可能是 UTF-16，双零结尾）
      const enc = body[0]!;
      if (enc === 1 || enc === 2) {
        while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
        p += 2;
      } else {
        while (p < body.length && body[p] !== 0) p++;
        p += 1;
      }
      if (p < body.length) {
        out.cover = { blob: new Blob([toBlobPart(body.subarray(p))], { type: mime }), ext: extOfMime(mime) };
      }
    }
    at += headerLen + frameSize;
  }
  return out.title || out.artist || out.cover ? out : null;
}

function parseFlac(data: Uint8Array): AudioMeta | null {
  if (data.length < 8 || ascii(data, 0, 4) !== "fLaC") return null;
  const out: AudioMeta = { title: null, artist: null, cover: null };
  let at = 4;
  const u32be = (p: number) =>
    ((data[p]! << 24) | (data[p + 1]! << 16) | (data[p + 2]! << 8) | data[p + 3]!) >>> 0;
  const u32le = (p: number) =>
    (data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16) | (data[p + 3]! << 24)) >>> 0;

  while (at + 4 <= data.length) {
    const header = data[at]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!;
    const body = data.subarray(at + 4, at + 4 + len);
    if (type === 4) {
      // VORBIS_COMMENT：小端长度前缀
      let p = 0;
      const vendorLen = u32le(at + 4);
      p = 4 + vendorLen;
      const count = body.length >= p + 4 ? u32le(at + 4 + p) : 0;
      p += 4;
      for (let i = 0; i < count && p + 4 <= body.length; i++) {
        const fieldLen = u32le(at + 4 + p);
        p += 4;
        const text = new TextDecoder("utf-8").decode(body.subarray(p, p + fieldLen));
        p += fieldLen;
        const eq = text.indexOf("=");
        if (eq <= 0) continue;
        const key = text.slice(0, eq).toUpperCase();
        const value = text.slice(eq + 1).trim();
        if (!value) continue;
        if (key === "TITLE") out.title ||= value;
        else if (key === "ARTIST") out.artist ||= value;
      }
    } else if (type === 6 && !out.cover) {
      // PICTURE：大端长度前缀
      let p = 4; // picture type
      const mimeLen = u32be(at + 4 + p);
      p += 4;
      const mime = ascii(body, p, mimeLen) || "image/jpeg";
      p += mimeLen;
      const descLen = u32be(at + 4 + p);
      p += 4 + descLen;
      p += 16; // width/height/depth/colors
      const dataLen = u32be(at + 4 + p);
      p += 4;
      if (dataLen > 0 && p + dataLen <= body.length) {
        out.cover = {
          blob: new Blob([toBlobPart(body.subarray(p, p + dataLen))], { type: mime }),
          ext: extOfMime(mime),
        };
      }
    }
    at += 4 + len;
    if (last) break;
  }
  return out.title || out.artist || out.cover ? out : null;
}

/** 读取原曲文件的歌名 / 歌手 / 封面；读不到时各字段为 null */
export async function readAudioMeta(file: File): Promise<AudioMeta> {
  try {
    // 封面通常在文件头部；先读前 8MB，够覆盖绝大多数标签块
    const head = new Uint8Array(await file.slice(0, 8 * 1024 * 1024).arrayBuffer());
    return parseFlac(head) ?? parseId3(head) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
