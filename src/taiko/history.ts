/**
 * 历史演奏：只记本机（localStorage），最多 100 条。
 */
import type { Difficulty } from "./difficulty";

const KEY = "taiko.history.v1";
const MAX = 100;

export interface HistoryEntry {
  songId: string;
  title: string;
  artist?: string | null;
  difficulty: Difficulty;
  speed: number;
  /** 准确率 0~100，可缺 */
  accuracy?: number;
  maxCombo?: number;
  notes?: number;
  /** 是否完整打完；缺省视为完成（兼容旧记录） */
  completed?: boolean;
  /** 未完成时的进度 0~100 */
  progress?: number;
  playedAt: number;
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

export function addHistory(entry: HistoryEntry): void {
  if (typeof localStorage === "undefined") return;
  try {
    const list = [entry, ...readHistory()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 存储不可用时忽略
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
