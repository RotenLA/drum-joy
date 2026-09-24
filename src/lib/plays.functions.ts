/**
 * 账号同步的演奏记录。玩家 id 来自宿主 window.__pd2uGetUser()（无签名，仅做格式与范围校验）。
 * 表不对前端开放，读写全部走这里。
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const userId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const record = z.object({
  songId: z.string().min(1).max(64),
  title: z.string().max(200).default(""),
  difficulty: z.enum(["easy", "beginner", "standard", "hard"]),
  speed: z.number().min(0.1).max(5),
  score: z.number().int().min(0).max(1_000_000),
  accuracy: z.number().min(0).max(100),
  maxCombo: z.number().int().min(0).max(100000),
  notes: z.number().int().min(0).max(100000),
  progress: z.number().int().min(0).max(100),
  completed: z.boolean(),
  playedAt: z.number().int().min(0),
});
export type PlayRecordInput = z.infer<typeof record>;

export interface PlayBest {
  songId: string;
  difficulty: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  progress: number;
  completed: boolean;
  plays: number;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function saveRecords(uid: string, recs: PlayRecordInput[]) {
  const db = await admin();
  const rows = recs.map((r) => ({
    user_id: uid,
    song_id: r.songId,
    title: r.title,
    difficulty: r.difficulty,
    speed: r.speed,
    score: r.score,
    accuracy: r.accuracy,
    max_combo: r.maxCombo,
    notes: r.notes,
    progress: r.progress,
    completed: r.completed,
    played_at: new Date(r.playedAt).toISOString(),
  }));
  if (rows.length) {
    const { error } = await db
      .from("play_records")
      .upsert(rows, { onConflict: "user_id,played_at,song_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  // 更新最佳成绩
  const keys = new Map<string, PlayRecordInput[]>();
  for (const r of recs) {
    const k = `${r.songId}|${r.difficulty}`;
    keys.set(k, [...(keys.get(k) ?? []), r]);
  }
  for (const [k, list] of keys) {
    const [songId, difficulty] = k.split("|") as [string, string];
    const { data: cur } = await db
      .from("play_bests")
      .select("*")
      .eq("user_id", uid)
      .eq("song_id", songId)
      .eq("difficulty", difficulty)
      .maybeSingle();
    const b = {
      user_id: uid,
      song_id: songId,
      difficulty,
      best_score: cur?.best_score ?? 0,
      best_accuracy: Number(cur?.best_accuracy ?? 0),
      best_combo: cur?.best_combo ?? 0,
      best_progress: cur?.best_progress ?? 0,
      completed: cur?.completed ?? false,
      plays: (cur?.plays ?? 0) + list.length,
      updated_at: new Date().toISOString(),
    };
    for (const r of list) {
      b.best_score = Math.max(b.best_score, r.score);
      b.best_accuracy = Math.max(b.best_accuracy, r.accuracy);
      b.best_combo = Math.max(b.best_combo, r.maxCombo);
      b.best_progress = Math.max(b.best_progress, r.progress);
      b.completed = b.completed || r.completed;
    }
    const { error } = await db.from("play_bests").upsert(b);
    if (error) throw new Error(error.message);
  }
}

export const submitPlay = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId, record }).parse(d))
  .handler(async ({ data }) => {
    await saveRecords(data.userId, [data.record]);
    return { ok: true };
  });

export const importLocalHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId, records: z.array(record).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    await saveRecords(data.userId, data.records);
    return { ok: true };
  });

export const getPlayData = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const [bestsRes, histRes] = await Promise.all([
      db.from("play_bests").select("*").eq("user_id", data.userId),
      db
        .from("play_records")
        .select("*")
        .eq("user_id", data.userId)
        .order("played_at", { ascending: false })
        .limit(100),
    ]);
    const bests: PlayBest[] = (bestsRes.data ?? []).map((r) => ({
      songId: r.song_id,
      difficulty: r.difficulty,
      score: r.best_score,
      accuracy: Number(r.best_accuracy),
      maxCombo: r.best_combo,
      progress: r.best_progress,
      completed: r.completed,
      plays: r.plays,
    }));
    const history = (histRes.data ?? []).map((r) => ({
      songId: r.song_id,
      title: r.title,
      difficulty: r.difficulty,
      speed: Number(r.speed),
      score: r.score,
      accuracy: Number(r.accuracy),
      maxCombo: r.max_combo,
      notes: r.notes,
      progress: r.progress,
      completed: r.completed,
      playedAt: new Date(r.played_at).getTime(),
    }));
    return { bests, history };
  });
