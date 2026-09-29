/**
 * 历史演奏：有玩家 id（window.__pd2uGetUser）时同步到云端，否则只存本机。
 */
import type { Difficulty } from "./difficulty";
import {
  getPlayData,
  importLocalHistory,
  submitPlay,
  getFavorites,
  importFavorites,
  toggleFavorite,
  type PlayBest,
} from "@/lib/plays.functions";

const KEY = "taiko.history.v1";
const IMPORTED_KEY = "taiko.history.imported.v1";
const MAX = 100;
let playDataPromise: Promise<{ history: HistoryEntry[]; bests: BestMap; synced: boolean }> | null = null;
let favoritesPromise: Promise<string[]> | null = null;

export type { PlayBest };

export interface HistoryEntry {
  songId: string;
  title: string;
  artist?: string | null;
  difficulty: Difficulty;
  speed: number;
  /** 0~1,000,000 */
  score?: number;
  accuracy?: number;
  maxCombo?: number;
  notes?: number;
  completed?: boolean;
  /** 完成且无 Miss */
  fullCombo?: boolean;
  progress?: number;
  playedAt: number;
}

/** 宿主玩家 id；未登录/浏览器直开返回 null */
export function getHostUserId(): string | null {
  try {
    const fn = (window as unknown as { __pd2uGetUser?: () => unknown }).__pd2uGetUser;
    if (typeof fn !== "function") return null;
    let r = fn();
    if (typeof r === "string") r = JSON.parse(r);
    const id = (r as { id?: unknown } | null)?.id;
    return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** 宿主玩家昵称（可选 name 字段）；没有则 null */
export function getHostUserName(): string | null {
  try {
    const fn = (window as unknown as { __pd2uGetUser?: () => unknown }).__pd2uGetUser;
    if (typeof fn !== "function") return null;
    let r = fn();
    if (typeof r === "string") r = JSON.parse(r);
    const n = (r as { name?: unknown } | null)?.name;
    return typeof n === "string" && n.trim() ? n.trim().slice(0, 40) : null;
  } catch {
    return null;
  }
}

export function readHistory(): HistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const toInput = (e: HistoryEntry) => ({
  songId: e.songId,
  title: (e.title ?? "").slice(0, 200),
  difficulty: e.difficulty,
  speed: e.speed || 1,
  score: Math.round(e.score ?? (e.accuracy ?? 0) * 10000),
  accuracy: Math.max(0, Math.min(100, e.accuracy ?? 0)),
  maxCombo: e.maxCombo ?? 0,
  notes: e.notes ?? 0,
  progress: Math.round(e.completed === false ? (e.progress ?? 0) : 100),
  completed: e.completed !== false,
  fullCombo: e.fullCombo === true && e.completed !== false,
  playedAt: Math.round(e.playedAt),
});

/** 记一条演奏；返回是否破本机纪录，以及（已登录时）云端名次 */
export async function addHistory(
  entry: HistoryEntry,
): Promise<{ newBest: boolean; rank: number | null }> {
  let newBest = false;
  if (typeof localStorage !== "undefined") {
    try {
      const prev = readHistory();
      const prevBest = prev
        .filter((h) => h.songId === entry.songId && h.difficulty === entry.difficulty)
        .reduce((m, h) => Math.max(m, h.score ?? 0), 0);
      newBest = entry.completed !== false && (entry.score ?? 0) > prevBest && prev.some((h) => h.songId === entry.songId && h.difficulty === entry.difficulty);
      localStorage.setItem(KEY, JSON.stringify([entry, ...prev].slice(0, MAX)));
      if (playDataPromise) {
        playDataPromise = playDataPromise.then((cached) => {
          const history = [entry, ...cached.history].slice(0, MAX);
          return { ...cached, history, bests: mergeBest(cached.bests, entry) };
        });
      }
    } catch {
      // 存储不可用时忽略
    }
  }
  const uid = getHostUserId();
  if (uid && entry.songId) {
    try {
      const r = await submitPlay({
        data: { userId: uid, record: toInput(entry), name: getHostUserName() },
      });
      return { newBest, rank: r.rank ?? null };
    } catch (e) {
      console.warn("[history] 云端写入失败", e);
    }
  }
  return { newBest, rank: null };
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
    playDataPromise = null;
  } catch {
    // ignore
  }
}

/** 最佳成绩按「songId|difficulty」索引 */
export type BestMap = Record<string, PlayBest>;

function localBests(list: HistoryEntry[]): BestMap {
  const m: BestMap = {};
  for (const e of list) {
    if (!e.songId) continue;
    const r = toInput(e);
    const k = `${r.songId}|${r.difficulty}`;
    const b = m[k] ?? {
      songId: r.songId,
      difficulty: r.difficulty,
      score: 0,
      accuracy: 0,
      maxCombo: 0,
      progress: 0,
      completed: false,
      fullCombo: false,
      plays: 0,
    };
    b.score = Math.max(b.score, r.score);
    b.accuracy = Math.max(b.accuracy, r.accuracy);
    b.maxCombo = Math.max(b.maxCombo, r.maxCombo);
    b.progress = Math.max(b.progress, r.progress);
    b.completed = b.completed || r.completed;
    b.fullCombo = b.fullCombo || r.fullCombo;
    b.plays += 1;
    m[k] = b;
  }
  return m;
}

function mergeBest(bests: BestMap, entry: HistoryEntry): BestMap {
  if (!entry.songId) return bests;
  const r = toInput(entry);
  const key = `${r.songId}|${r.difficulty}`;
  const current = bests[key];
  return {
    ...bests,
    [key]: {
      songId: r.songId,
      difficulty: r.difficulty,
      score: Math.max(current?.score ?? 0, r.score),
      accuracy: Math.max(current?.accuracy ?? 0, r.accuracy),
      maxCombo: Math.max(current?.maxCombo ?? 0, r.maxCombo),
      progress: Math.max(current?.progress ?? 0, r.progress),
      completed: (current?.completed ?? false) || r.completed,
      fullCombo: (current?.fullCombo ?? false) || r.fullCombo,
      plays: (current?.plays ?? 0) + 1,
    },
  };
}

/** 读取历史与最佳成绩：有账号走云端（首次合并本机记录），否则本机 */
async function fetchPlayData(): Promise<{
  history: HistoryEntry[];
  bests: BestMap;
  synced: boolean;
}> {
  const local = readHistory();
  const uid = getHostUserId();
  if (!uid) return { history: local, bests: localBests(local), synced: false };
  try {
    const flag = `${IMPORTED_KEY}:${uid}`;
    if (!localStorage.getItem(flag)) {
      const recs = local.filter((e) => e.songId).map(toInput);
      if (recs.length) await importLocalHistory({ data: { userId: uid, records: recs } });
      localStorage.setItem(flag, "1");
    }
    const res = await getPlayData({ data: { userId: uid } });
    const bests: BestMap = {};
    for (const b of res.bests) bests[`${b.songId}|${b.difficulty}`] = b;
    return {
      history: res.history.map((h) => ({ ...h, difficulty: h.difficulty as Difficulty })),
      bests,
      synced: true,
    };
  } catch (e) {
    console.warn("[history] 云端读取失败，使用本机", e);
    return { history: local, bests: localBests(local), synced: false };
  }
}

export function loadPlayData(): Promise<{ history: HistoryEntry[]; bests: BestMap; synced: boolean }> {
  playDataPromise ??= fetchPlayData();
  return playDataPromise;
}

/** 难度解锁：轻松/入门常开；标准需入门全连击；困难需标准全连击 */
const UNLOCK_REQ: Partial<Record<Difficulty, Difficulty>> = { standard: "beginner", hard: "standard" };
export function unlockRequirement(diff: Difficulty): Difficulty | null {
  return UNLOCK_REQ[diff] ?? null;
}
export function isUnlocked(bests: BestMap, songId: string, diff: Difficulty): boolean {
  const req = UNLOCK_REQ[diff];
  if (!req) return true;
  return bests[`${songId}|${req}`]?.fullCombo === true;
}

// ================= 收藏 =================
const FAV_KEY = "taiko.favorites.v1";
const FAV_IMPORTED = "taiko.favorites.imported.v1";

function readLocalFavs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeLocalFavs(ids: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** 读取收藏（最新收藏在前）；有账号时首次把本机收藏合并到云端 */
async function fetchFavorites(): Promise<string[]> {
  const local = readLocalFavs();
  const uid = getHostUserId();
  if (!uid) return local;
  try {
    const flag = `${FAV_IMPORTED}:${uid}`;
    if (!localStorage.getItem(flag)) {
      if (local.length) await importFavorites({ data: { userId: uid, songIds: local.slice(0, 500) } });
      localStorage.setItem(flag, "1");
    }
    const r = await getFavorites({ data: { userId: uid } });
    return r.songIds;
  } catch (e) {
    console.warn("[favorites] 云端读取失败，使用本机", e);
    return local;
  }
}

export function loadFavorites(): Promise<string[]> {
  favoritesPromise ??= fetchFavorites();
  return favoritesPromise;
}

export async function setFavorite(songId: string, on: boolean): Promise<void> {
  const cur = readLocalFavs().filter((x) => x !== songId);
  writeLocalFavs(on ? [songId, ...cur] : cur);
  favoritesPromise = Promise.resolve(on ? [songId, ...cur] : cur);
  const uid = getHostUserId();
  if (!uid) return;
  try {
    await toggleFavorite({ data: { userId: uid, songId, on } });
  } catch (e) {
    console.warn("[favorites] 云端写入失败", e);
  }
}
