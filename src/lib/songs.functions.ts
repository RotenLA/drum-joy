/**
 * 玩家侧曲库读取：上架歌曲列表 + 下载直链 + 云端固化谱面。
 * 存储桶为私有桶，下载走一小时有效的签名链接。
 */
import { createServerFn } from "@tanstack/react-start";
import type { TaikoChart } from "@/shared/taikoChart";

const BUCKET = "songs";
const URL_TTL = 3600;
const COVER_TTL = 86400;

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
  tagIds: string[];
  /** 原曲内嵌封面的签名直链（无封面为 null） */
  coverUrl: string | null;
}


export interface LibraryTag {
  id: string;
  name: string;
  nameEn: string | null;
}

/** 轻量曲库版本；应用每次全新打开只查询一次。 */
export const getLibraryRevision = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("library_revision")
    .select("version")
    .eq("id", true)
    .single();
  if (error || !data) throw new Error(error?.message ?? "曲库版本读取失败");
  return { version: Number(data.version) };
});

export const listLibrarySongs = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("songs")
    .select(
      "id, title, artist, duration_ms, bpm, ts_num, ts_den, midi_fingerprint, sizes, created_at, cover_path",
    )
    .eq("published", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const signCover = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    const { data: signed } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, COVER_TTL);
    return signed?.signedUrl ?? null;
  };
  const songs: LibrarySong[] = await Promise.all(
    (data ?? []).map(async (r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      durationMs: r.duration_ms,
      bpm: Number(r.bpm),
      timeSignature: [r.ts_num, r.ts_den] as [number, number],
      fingerprint: r.midi_fingerprint,
      sizes: (r.sizes ?? {}) as Record<string, number>,
      createdAt: r.created_at,
      tagIds: [] as string[],
      coverUrl: await signCover(r.cover_path),
    })),
  );
  const [tagsRes, linksRes] = await Promise.all([
    supabaseAdmin.from("song_tags").select("id, name, name_en, sort_order").order("sort_order"),
    supabaseAdmin.from("song_tag_links").select("song_id, tag_id"),
  ]);

  const byId = new Map(songs.map((s) => [s.id, s]));
  for (const l of linksRes.data ?? []) byId.get(l.song_id)?.tagIds.push(l.tag_id);
  const tags: LibraryTag[] = (tagsRes.data ?? []).map((t) => ({ id: t.id, name: t.name, nameEn: t.name_en }));
  return { songs, tags };
});

export interface SongAssets {
  urls: { vocals: string | null; bass: string | null; drums: string | null; other: string | null; midi: string };
  sizes: Record<string, number>;
  charts: Record<string, TaikoChart>;
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
      // 早期歌曲保存的是 Lovable Assets 绝对地址。只返回资源路径，避免
      // 预览/自定义域名从旧正式域名下载时发生跨域重定向。
      if (/^https?:\/\//i.test(path)) {
        try {
          const url = new URL(path);
          if (url.pathname.startsWith("/__l5e/assets-v1/")) {
            return `${url.pathname}${url.search}`;
          }
        } catch {
          throw new Error("歌曲文件地址无效");
        }
        return path;
      }
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
    const charts: Record<string, TaikoChart> = {};
    for (const row of chartRows ?? []) charts[row.difficulty] = row.chart as unknown as TaikoChart;

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

/** 仅刷新封面临时链接（曲库快照复用时每个会话调用一次） */
export const listCoverUrls = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("songs").select("id, cover_path").eq("published", true);
  if (error) throw new Error(error.message);
  const out: Record<string, string | null> = {};
  await Promise.all((data ?? []).map(async (r) => {
    if (!r.cover_path) { out[r.id] = null; return; }
    if (/^https?:\/\//i.test(r.cover_path)) { out[r.id] = r.cover_path; return; }
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(r.cover_path, COVER_TTL);
    out[r.id] = signed?.signedUrl ?? null;
  }));
  return out;
});
