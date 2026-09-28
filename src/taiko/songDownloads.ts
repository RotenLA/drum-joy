/**
 * 歌曲本地下载：原始文件（MIDI + 分轨 mp3 + 云端谱面）存 IndexedDB，重启后仍在。
 * 下载只存字节不解码；同时只下一首，可取消。键 = song_id + midi_fingerprint。
 */
import { useSyncExternalStore } from "react";
import { getSongAssets, type LibrarySong } from "@/lib/songs.functions";
import { STEM_KINDS, type StemKind } from "./stems";

export interface StoredSong {
  key: string;
  songId: string;
  midi: ArrayBuffer;
  stems: Partial<Record<StemKind, ArrayBuffer>>;
  charts: Record<string, unknown>;
  savedAt: number;
}

const DB_NAME = "pd2u-songs";
const STORE = "songs";
const keyOf = (s: LibrarySong) => `${s.id}|${s.fingerprint}`;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = run(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

// ---------- 状态 store ----------
interface DlState {
  /** 已下载的 key 集合 */
  done: Set<string>;
  /** 正在下载的 songId 与百分比 */
  activeId: string | null;
  percent: number;
  errorId: string | null;
}
let state: DlState = { done: new Set(), activeId: null, percent: 0, errorId: null };
const subs = new Set<() => void>();
const emit = (patch: Partial<DlState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const SERVER: DlState = state;

export function useDownloads(): DlState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}
export const isDownloaded = (s: LibrarySong) => state.done.has(keyOf(s));

let scanned = false;
export async function scanDownloads(): Promise<void> {
  if (scanned) return;
  scanned = true;
  try {
    const keys = await tx("readonly", (s) => s.getAllKeys());
    emit({ done: new Set(keys.map(String)) });
  } catch {
    /* 无存储：每次都走下载 */
  }
}

export async function readStored(s: LibrarySong): Promise<StoredSong | null> {
  try {
    return ((await tx("readonly", (st) => st.get(keyOf(s)))) as StoredSong | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function removeStored(s: LibrarySong): Promise<void> {
  try {
    await tx("readwrite", (st) => st.delete(keyOf(s)));
  } catch {
    /* ignore */
  }
  const done = new Set(state.done);
  done.delete(keyOf(s));
  emit({ done });
}

// ---------- 下载 ----------
let controller: AbortController | null = null;

async function fetchBytes(url: string, signal: AbortSignal, onBytes: (n: number) => void) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`download ${res.status}`);
  if (!res.body) {
    const b = await res.arrayBuffer();
    onBytes(b.byteLength);
    return b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      onBytes(value.byteLength);
    }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

export function cancelDownload(): void {
  controller?.abort();
}

/** 开始下载；若已有下载进行中则先取消它。成功返回 true，取消/失败返回 false。 */
export async function downloadSong(song: LibrarySong): Promise<boolean> {
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  emit({ activeId: song.id, percent: 0, errorId: null });
  try {
    const assets = await getSongAssets({ data: { id: song.id } });
    const total = Object.values(assets.sizes).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
    let got = 0;
    const bump = (n: number) => {
      got += n;
      if (controller === ctrl) emit({ percent: Math.min(99, Math.round((got / total) * 100)) });
    };
    const midi = await fetchBytes(assets.urls.midi, ctrl.signal, bump);
    const stems: Partial<Record<StemKind, ArrayBuffer>> = {};
    for (const k of STEM_KINDS) {
      if (k === "drums") continue; // 鼓轨始终静音，不下载
      const url = assets.urls[k];
      if (url) stems[k] = await fetchBytes(url, ctrl.signal, bump);
    }
    const rec: StoredSong = {
      key: keyOf(song),
      songId: song.id,
      midi,
      stems,
      charts: assets.charts as Record<string, unknown>,
      savedAt: Date.now(),
    };
    try {
      await tx("readwrite", (st) => st.put(rec));
    } catch {
      memoryFallback.set(rec.key, rec);
    }
    const done = new Set(state.done);
    done.add(rec.key);
    if (controller === ctrl) controller = null;
    emit({ done, activeId: null, percent: 0 });
    return true;
  } catch (err) {
    const aborted = ctrl.signal.aborted;
    if (controller === ctrl) {
      controller = null;
      emit({ activeId: null, percent: 0, errorId: aborted ? null : song.id });
    }
    if (!aborted) console.error(err);
    return false;
  }
}

/** IndexedDB 不可用（隐私模式等）时的内存兜底，仅本次会话有效 */
const memoryFallback = new Map<string, StoredSong>();
export async function readStoredAny(s: LibrarySong): Promise<StoredSong | null> {
  return (await readStored(s)) ?? memoryFallback.get(keyOf(s)) ?? null;
}
