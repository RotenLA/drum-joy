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
  fullCombo: z.boolean().optional(),
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
  fullCombo: boolean;
  plays: number;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function saveRecords(uid: string, recs: PlayRecordInput[], name?: string | null) {
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
    full_combo: r.fullCombo === true && r.completed,
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
      full_combo: cur?.full_combo ?? false,
      plays: (cur?.plays ?? 0) + list.length,
      updated_at: new Date().toISOString(),
      player_name: name ?? (cur as { player_name?: string | null } | null)?.player_name ?? null,
    };
    for (const r of list) {
      b.best_score = Math.max(b.best_score, r.score);
      b.best_accuracy = Math.max(b.best_accuracy, r.accuracy);
      b.best_combo = Math.max(b.best_combo, r.maxCombo);
      b.best_progress = Math.max(b.best_progress, r.progress);
      b.completed = b.completed || r.completed;
      b.full_combo = b.full_combo || (r.fullCombo === true && r.completed);
    }
    const { error } = await db.from("play_bests").upsert(b);
    if (error) throw new Error(error.message);
  }
}

export const submitPlay = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId, record, name: z.string().max(40).nullish() }).parse(d),
  )
  .handler(async ({ data }) => {
    await saveRecords(data.userId, [data.record], data.name ?? null);
    const rank = await rankOf(data.userId, data.record.songId, data.record.difficulty);
    return { ok: true, rank };
  });

async function rankOf(uid: string, songId: string, difficulty: string): Promise<number | null> {
  const db = await admin();
  const { data: mine } = await db
    .from("play_bests")
    .select("best_score")
    .eq("user_id", uid)
    .eq("song_id", songId)
    .eq("difficulty", difficulty)
    .maybeSingle();
  if (!mine || mine.best_score <= 0) return null;
  const { count } = await db
    .from("play_bests")
    .select("user_id", { count: "exact", head: true })
    .eq("song_id", songId)
    .eq("difficulty", difficulty)
    .gt("best_score", mine.best_score);
  return (count ?? 0) + 1;
}

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  accuracy: number;
  fullCombo: boolean;
  me: boolean;
}

const maskId = (id: string) => `••${id.slice(-4)}`;

/** 每首歌每档难度前 20 名 + 我的名次；不返回完整 user_id */
export const getLeaderboard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        songId: z.string().min(1).max(64),
        difficulty: z.enum(["easy", "beginner", "standard", "hard"]),
        userId: userId.nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: rows } = await db
      .from("play_bests")
      .select("user_id, player_name, best_score, best_accuracy, full_combo")
      .eq("song_id", data.songId)
      .eq("difficulty", data.difficulty)
      .gt("best_score", 0)
      .order("best_score", { ascending: false })
      .limit(20);
    const top: BoardRow[] = (rows ?? []).map((r, i) => ({
      rank: i + 1,
      name: r.player_name || maskId(r.user_id),
      score: r.best_score,
      accuracy: Number(r.best_accuracy),
      fullCombo: r.full_combo,
      me: !!data.userId && r.user_id === data.userId,
    }));
    let mine: BoardRow | null = top.find((r) => r.me) ?? null;
    if (!mine && data.userId) {
      const rank = await rankOf(data.userId, data.songId, data.difficulty);
      if (rank) {
        const { data: m } = await db
          .from("play_bests")
          .select("player_name, best_score, best_accuracy, full_combo")
          .eq("user_id", data.userId)
          .eq("song_id", data.songId)
          .eq("difficulty", data.difficulty)
          .maybeSingle();
        if (m)
          mine = {
            rank,
            name: m.player_name || maskId(data.userId),
            score: m.best_score,
            accuracy: Number(m.best_accuracy),
            fullCombo: m.full_combo,
            me: true,
          };
      }
    }
    return { top, mine };
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
      fullCombo: r.full_combo,
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

const songIdZ = z.string().min(1).max(64);

export const getFavorites = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: rows } = await db
      .from("song_favorites")
      .select("song_id")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    return { songIds: (rows ?? []).map((r) => r.song_id) };
  });

export const toggleFavorite = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId, songId: songIdZ, on: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const q = data.on
      ? db.from("song_favorites").upsert({ user_id: data.userId, song_id: data.songId })
      : db.from("song_favorites").delete().eq("user_id", data.userId).eq("song_id", data.songId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const importFavorites = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ userId, songIds: z.array(songIdZ).max(500) }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    if (data.songIds.length) {
      const { error } = await db
        .from("song_favorites")
        .upsert(
          data.songIds.map((id) => ({ user_id: data.userId, song_id: id })),
          { onConflict: "user_id,song_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
