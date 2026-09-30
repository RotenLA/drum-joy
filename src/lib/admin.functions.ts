/**
 * 歌曲后台（/admin）用的服务端函数：
 * 共享账号口令校验（服务端 timing-safe 比较 + 加密会话），
 * 以及曲库的上传直链、入库、改名/上下架/删除。
 */
import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { EXPORT_DIFFICULTIES, type ChartExportSourceSong } from "@/shared/chartExport";

const BUCKET = "songs";

interface GateSession {
  admin?: boolean;
}

function sessionConfig() {
  return {
    password: process.env["SESSION_SECRET"]!,
    name: "song-admin",
    maxAge: 60 * 60 * 24 * 7,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  };
}

function matches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

async function requireAdmin() {
  const session = await useSession<GateSession>(sessionConfig());
  if (!session.data.admin) throw new Error("UNAUTHORIZED");
  return session;
}

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { username: string; password: string }) => data)
  .handler(async ({ data }) => {
    const user = process.env["ADMIN_USERNAME"];
    const pass = process.env["ADMIN_PASSWORD"];
    if (!user || !pass) return { ok: false as const };
    if (!matches(data.username, user) || !matches(data.password, pass)) {
      return { ok: false as const };
    }
    const session = await useSession<GateSession>(sessionConfig());
    await session.update({ admin: true });
    return { ok: true as const };
  });

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  return { signedIn: session.data.admin === true };
});

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await useSession<GateSession>(sessionConfig());
  await session.clear();
  return { ok: true as const };
});

/** 为一首歌的 5 个文件申请上传直链（浏览器直传，不经过服务端流量） */
export const createUploadTargets = createServerFn({ method: "POST" })
  .inputValidator((data: { folder: string; files: { key: string; ext: string }[] }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safeFolder = data.folder.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "song";
    const stamp = Date.now().toString(36);
    const out: { key: string; path: string; token: string }[] = [];
    for (const f of data.files) {
      const path = `${safeFolder}-${stamp}/${f.key}.${f.ext.replace(/[^a-z0-9]/gi, "")}`;
      const { data: signed, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error || !signed) throw new Error(error?.message ?? "签名失败");
      out.push({ key: f.key, path, token: signed.token });
    }
    return { targets: out };
  });

export interface SaveSongInput {
  title: string;
  artist: string | null;
  durationMs: number;
  bpm: number;
  tsNum: number;
  tsDen: number;
  fingerprint: string;
  paths: {
    vocals: string | null;
    bass: string | null;
    drums: string | null;
    other: string | null;
    midi: string;
    /** 节拍器基准轨：只在后台解析计时用，玩家端不下载 */
    metro?: string | null;
    /** 原曲内嵌封面 */
    cover?: string | null;
  };

  sizes: Record<string, number>;
  published?: boolean;
  charts: { difficulty: string; chart: unknown }[];
  tagIds?: string[];
}

/** 入库：歌曲元数据 + 预生成的四档谱面 */
export const saveSong = createServerFn({ method: "POST" })
  .inputValidator((data: SaveSongInput) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .insert({
        title: data.title,
        artist: data.artist,
        duration_ms: Math.round(data.durationMs),
        bpm: data.bpm,
        ts_num: data.tsNum,
        ts_den: data.tsDen,
        midi_fingerprint: data.fingerprint,
        vocals_path: data.paths.vocals,
        bass_path: data.paths.bass,
        drums_path: data.paths.drums,
        other_path: data.paths.other,
        midi_path: data.paths.midi,
        metro_path: data.paths.metro ?? null,
        cover_path: data.paths.cover ?? null,

        sizes: data.sizes,
        published: data.published ?? true,
      })
      .select("id")
      .single();
    if (error || !song) throw new Error(error?.message ?? "入库失败");

    const rows = data.charts.map((c) => ({
      song_id: song.id,
      difficulty: c.difficulty,
      midi_fingerprint: data.fingerprint,
      chart: c.chart as never,
    }));
    const { error: chartErr } = await supabaseAdmin.from("song_charts").insert(rows);
    if (chartErr) throw new Error(chartErr.message);
    if (data.tagIds?.length) {
      await supabaseAdmin
        .from("song_tag_links")
        .insert(data.tagIds.map((tag_id) => ({ song_id: song.id, tag_id })));
    }
    return { id: song.id };
  });

/** 替换某首歌的四档谱面（重新生成用） */
export const replaceCharts = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { songId: string; fingerprint: string; charts: { difficulty: string; chart: unknown }[] }) =>
      data,
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("song_charts").upsert(
      data.charts.map((c) => ({
        song_id: data.songId,
        difficulty: c.difficulty,
        midi_fingerprint: data.fingerprint,
        chart: c.chart as never,
      })),
      { onConflict: "song_id,difficulty,midi_fingerprint" },
    );
    if (error) throw new Error(error.message);
    const { error: songError } = await supabaseAdmin
      .from("songs")
      .update({ midi_fingerprint: data.fingerprint })
      .eq("id", data.songId);
    if (songError) throw new Error(songError.message);
    await supabaseAdmin.from("song_charts").delete().eq("song_id", data.songId).neq("midi_fingerprint", data.fingerprint);
    return { ok: true as const };
  });

/** 速度重算：原地更新歌曲元数据与四档谱面，不改变歌曲身份或关联数据。 */
export const replaceTempoAndCharts = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      songId: string;
      bpm: number;
      fingerprint: string;
      charts: { difficulty: string; chart: unknown }[];
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 先写新版本，再切换歌曲指针，最后删旧版本；任一步写入失败都不会先清空旧谱。
    const { error: chartError } = await supabaseAdmin.from("song_charts").upsert(
      data.charts.map((chart) => ({
        song_id: data.songId,
        difficulty: chart.difficulty,
        midi_fingerprint: data.fingerprint,
        chart: chart.chart as never,
      })),
      { onConflict: "song_id,difficulty,midi_fingerprint" },
    );
    if (chartError) throw new Error(chartError.message);
    const { error: songError } = await supabaseAdmin
      .from("songs")
      .update({ bpm: data.bpm, midi_fingerprint: data.fingerprint })
      .eq("id", data.songId);
    if (songError) throw new Error(songError.message);
    await supabaseAdmin.from("song_charts").delete().eq("song_id", data.songId).neq("midi_fingerprint", data.fingerprint);
    return { ok: true as const };
  });

/** 后台列表（含未上架） */
export const listAllSongs = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("songs")
    .select("id, title, artist, duration_ms, bpm, ts_num, ts_den, midi_fingerprint, published, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { songs: data ?? [] };
});

/** 导出通用谱面所需的数据；不包含音频路径、签名链接或任何后台凭据。 */
export const exportChartData = createServerFn({ method: "POST" })
  .inputValidator((data: { songIds?: string[] }) => ({
    songIds: Array.from(new Set(data.songIds ?? [])).slice(0, 500),
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let songQuery = supabaseAdmin
      .from("songs")
      .select("id, title, artist, duration_ms, bpm, ts_num, ts_den, midi_fingerprint")
      .order("created_at", { ascending: false });
    if (data.songIds.length) songQuery = songQuery.in("id", data.songIds);
    const { data: songs, error: songError } = await songQuery;
    if (songError) throw new Error(songError.message);
    if (!songs?.length) throw new Error("没有找到可导出的歌曲");

    const songIds = songs.map((song) => song.id);
    const { data: chartRows, error: chartError } = await supabaseAdmin
      .from("song_charts")
      .select("song_id, difficulty, midi_fingerprint, chart")
      .in("song_id", songIds);
    if (chartError) throw new Error(chartError.message);

    const sourceSongs: ChartExportSourceSong[] = songs.map((song) => {
      const currentRows = (chartRows ?? []).filter(
        (row) => row.song_id === song.id && row.midi_fingerprint === song.midi_fingerprint,
      );
      const charts: ChartExportSourceSong["charts"] = {};
      for (const difficulty of EXPORT_DIFFICULTIES) {
        const row = currentRows.find((candidate) => candidate.difficulty === difficulty);
        if (!row) throw new Error(`《${song.title}》缺少 ${difficulty} 难度谱面`);
        charts[difficulty] = row.chart;
      }
      return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        durationMs: song.duration_ms,
        bpm: Number(song.bpm),
        timeSignature: [song.ts_num, song.ts_den],
        fingerprint: song.midi_fingerprint,
        charts,
      };
    });
    return { songs: sourceSongs };
  });

export const updateSong = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; title?: string; artist?: string | null; published?: boolean }) => data,
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { title?: string; artist?: string | null; published?: boolean } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.artist !== undefined) patch.artist = data.artist;
    if (data.published !== undefined) patch.published = data.published;
    const { error } = await supabaseAdmin.from("songs").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deleteSong = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song } = await supabaseAdmin
      .from("songs")
      .select("vocals_path, bass_path, drums_path, other_path, midi_path, metro_path, cover_path")
      .eq("id", data.id)
      .maybeSingle();
    const paths = [
      song?.vocals_path,
      song?.bass_path,
      song?.drums_path,
      song?.other_path,
      song?.midi_path,
      song?.metro_path,
      song?.cover_path,
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    if (paths.length) await supabaseAdmin.storage.from(BUCKET).remove(paths);
    const { error } = await supabaseAdmin.from("songs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** 后台重新生成谱面时需要重新下载 MIDI，以及（若有）节拍器基准轨 */
export const getSongMidiUrl = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select("midi_path, metro_path")
      .eq("id", data.id)
      .single();
    if (error || !song) throw new Error("歌曲不存在");
    const sign = async (path: string) => {
      if (/^https?:\/\//i.test(path)) return path;
      const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      if (sErr || !signed) throw new Error(sErr?.message ?? "取链接失败");
      return signed.signedUrl;
    };
    return {
      url: await sign(song.midi_path),
      metroUrl: song.metro_path ? await sign(song.metro_path) : null,
    };
  });


/** 后台速度分析所需资源；优先鼓分轨，无鼓分轨时回退到其他可用分轨。 */
export const getSongAnalysisAssets = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select("midi_path, drums_path, other_path, bass_path, vocals_path")
      .eq("id", data.id)
      .single();
    if (error || !song) throw new Error("歌曲不存在");
    const sign = async (path: string) => {
      if (/^https?:\/\//i.test(path)) return path;
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      if (signError || !signed) throw new Error(signError?.message ?? "取链接失败");
      return signed.signedUrl;
    };
    const audioPath = song.drums_path ?? song.other_path ?? song.bass_path ?? song.vocals_path;
    if (!audioPath) throw new Error("没有可分析的音频分轨");
    return { midiUrl: await sign(song.midi_path), audioUrl: await sign(audioPath) };
  });

/* ---------------- 自定义标签 ---------------- */

export const listTags = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: tags, error } = await supabaseAdmin
    .from("song_tags")
    .select("id, name, name_en, sort_order")
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  const { data: links, error: lErr } = await supabaseAdmin
    .from("song_tag_links")
    .select("song_id, tag_id");
  if (lErr) throw new Error(lErr.message);
  return { tags: tags ?? [], links: links ?? [] };
});

export const createTag = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; nameEn: string }) => ({
    name: String(data.name).trim().slice(0, 40),
    nameEn: String(data.nameEn).trim().slice(0, 60),
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    if (!data.name || !data.nameEn) throw new Error("中文名和英文名都不能为空");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: last } = await supabaseAdmin
      .from("song_tags")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("song_tags")
      .insert({ name: data.name, name_en: data.nameEn, sort_order: (last?.sort_order ?? 0) + 1 });
    if (error) throw new Error(error.code === "23505" ? "标签已存在" : error.message);
    return { ok: true as const };
  });

export const renameTag = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; name: string; nameEn: string }) => ({
    id: data.id,
    name: String(data.name).trim().slice(0, 40),
    nameEn: String(data.nameEn).trim().slice(0, 60),
  }))
  .handler(async ({ data }) => {
    await requireAdmin();
    if (!data.name || !data.nameEn) throw new Error("中文名和英文名都不能为空");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("song_tags").update({ name: data.name, name_en: data.nameEn }).eq("id", data.id);
    if (error) throw new Error(error.code === "23505" ? "标签已存在" : error.message);
    return { ok: true as const };
  });

export const deleteTag = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("song_tags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const reorderTags = createServerFn({ method: "POST" })
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (let i = 0; i < data.ids.length; i++) {
      await supabaseAdmin.from("song_tags").update({ sort_order: i + 1 }).eq("id", data.ids[i]!);
    }
    return { ok: true as const };
  });

export const setSongTags = createServerFn({ method: "POST" })
  .inputValidator((data: { songId: string; tagIds: string[] }) => data)
  .handler(async ({ data }) => {
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("song_tag_links").delete().eq("song_id", data.songId);
    if (data.tagIds.length) {
      const { error } = await supabaseAdmin
        .from("song_tag_links")
        .insert(data.tagIds.map((tag_id) => ({ song_id: data.songId, tag_id })));
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });
