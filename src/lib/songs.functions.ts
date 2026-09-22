/**
 * 玩家侧曲库读取：上架歌曲列表 + 下载直链 + 云端固化谱面。
 * 存储桶为私有桶，下载走一小时有效的签名链接。
 */
import { createServerFn } from "@tanstack/react-start";

const BUCKET = "songs";
const URL_TTL = 3600;

export interface LibrarySong {
  id: string;
  title: string;
  artist: string | null;
  durationMs: number;
  bpm: number;
  timeSignature: [number, number];
  fingerprint: string;
  sizes: Record<string, number>;
  createdAt: string;
}

export const listLibrarySongs = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("songs")
    .select(
      "id, title, artist, duration_ms, bpm, ts_num, ts_den, midi_fingerprint, sizes, created_at",
    )
    .eq("published", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const songs: LibrarySong[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    durationMs: r.duration_ms,
    bpm: Number(r.bpm),
    timeSignature: [r.ts_num, r.ts_den] as [number, number],
    fingerprint: r.midi_fingerprint,
    sizes: (r.sizes ?? {}) as Record<string, number>,
    createdAt: r.created_at,
  }));
  return { songs };
});

export interface SongAssets {
  urls: { vocals: string | null; bass: string | null; drums: string | null; other: string | null; midi: string };
  sizes: Record<string, number>;
  charts: Record<string, unknown>;
}

export const getSongAssets = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SongAssets> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select("vocals_path, bass_path, drums_path, other_path, midi_path, sizes, published")
      .eq("id", data.id)
      .single();
    if (error || !song || !song.published) throw new Error("歌曲不存在或已下架");

    const sign = async (path: string | null) => {
      if (!path) return null;
      // 早期歌曲直接存的是 CDN 绝对地址，无需签名
      if (/^https?:\/\//i.test(path)) return path;
      const { data: signed } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, URL_TTL);
      return signed?.signedUrl ?? null;
    };

    const midiUrl = await sign(song.midi_path);
    if (!midiUrl) throw new Error("MIDI 文件缺失");

    const { data: chartRows } = await supabaseAdmin
      .from("song_charts")
      .select("difficulty, chart")
      .eq("song_id", data.id);
    const charts: Record<string, unknown> = {};
    for (const row of chartRows ?? []) charts[row.difficulty] = row.chart;

    return {
      urls: {
        vocals: await sign(song.vocals_path),
        bass: await sign(song.bass_path),
        drums: await sign(song.drums_path),
        other: await sign(song.other_path),
        midi: midiUrl,
      },
      sizes: (song.sizes ?? {}) as Record<string, number>,
      charts,
    };
  });
