/**
 * 歌曲后台：共享账号登录后可上传歌曲（4 条分轨 + 鼓 MIDI），
 * 上传时自动读取 BPM / 拍号 / 时长，并预生成四档谱面入库。
 */
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseMidi } from "@/taiko/midiFile";
import { buildAllCharts, midiFingerprint } from "@/taiko/adminChartBuild";
import {
  groupImportFiles,
  type FolderImportSong,
  type ImportFileKey,
} from "@/taiko/adminFolderImport";
import {
  adminLogin,
  adminLogout,
  adminStatus,
  createUploadTargets,
  deleteSong,
  getSongMidiUrl,
  listAllSongs,
  replaceCharts,
  saveSong,
  updateSong,
  listTags,
  createTag,
  renameTag,
  deleteTag,
  reorderTags,
  setSongTags,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "歌曲后台 · AeroGame 曲库管理" },
      {
        name: "description",
        content: "上传分轨音频与鼓 MIDI，自动生成四档鼓谱并加入 AeroGame 曲库。",
      },
      { property: "og:title", content: "歌曲后台 · AeroGame 曲库管理" },
      {
        property: "og:description",
        content: "上传分轨音频与鼓 MIDI，自动生成四档鼓谱并加入 AeroGame 曲库。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminScroll,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-red-400">后台出错：{String((error as Error)?.message)}</div>
  ),
});

interface AdminSongRow {
  id: string;
  title: string;
  artist: string | null;
  duration_ms: number;
  bpm: number;
  ts_num: number;
  ts_den: number;
  published: boolean;
  created_at: string;
}

const STEM_FIELDS = [
  { key: "vocals", label: "人声 Vocals" },
  { key: "bass", label: "贝斯 Bass" },
  { key: "drums", label: "鼓 Drums" },
  { key: "other", label: "其他 Other" },
] as const;

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

async function audioDurationMs(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve) => {
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.onloadedmetadata = () => resolve((el.duration || 0) * 1000);
      el.onerror = () => resolve(0);
      el.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function AdminPage() {
  const login = useServerFn(adminLogin);
  const logout = useServerFn(adminLogout);
  const status = useServerFn(adminStatus);
  const list = useServerFn(listAllSongs);
  const signUploads = useServerFn(createUploadTargets);
  const save = useServerFn(saveSong);
  const update = useServerFn(updateSong);
  const remove = useServerFn(deleteSong);
  const midiUrlOf = useServerFn(getSongMidiUrl);
  const regenerate = useServerFn(replaceCharts);
  const fetchTags = useServerFn(listTags);
  const addTag = useServerFn(createTag);
  const renTag = useServerFn(renameTag);
  const delTag = useServerFn(deleteTag);
  const sortTags = useServerFn(reorderTags);
  const linkTags = useServerFn(setSongTags);

  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [newTag, setNewTag] = useState("");
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [editTagsOf, setEditTagsOf] = useState<string | null>(null);

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [loginErr, setLoginErr] = useState(false);

  const [songs, setSongs] = useState<AdminSongRow[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const stemInputs = useRef<Record<string, File | null>>({});
  const [midiFile, setMidiFile] = useState<File | null>(null);
  const [stemsPicked, setStemsPicked] = useState(0);
  const [folderSongs, setFolderSongs] = useState<FolderImportSong[]>([]);
  const [folderIgnored, setFolderIgnored] = useState<string[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  const refresh = useCallback(async () => {
    const res = await list();
    setSongs(res.songs as AdminSongRow[]);
    const t = await fetchTags();
    setTags(t.tags);
    const m: Record<string, string[]> = {};
    for (const l of t.links) (m[l.song_id] ??= []).push(l.tag_id);
    setTagMap(m);
  }, [list, fetchTags]);

  const tagAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      setNote(`操作失败：${(err as Error).message}`);
    }
  };
  const moveTag = (i: number, d: number) => {
    const ids = tags.map((t) => t.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void tagAction(() => sortTags({ data: { ids } }));
  };
  const toggleIn = (arr: string[], id: string) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  const tagCount = (id: string) =>
    Object.values(tagMap).filter((ids) => ids.includes(id)).length;

  useEffect(() => {
    void (async () => {
      const s = await status();
      setSignedIn(s.signedIn);
      if (s.signedIn) await refresh();
    })();
  }, [status, refresh]);

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(false);
    const res = await login({ data: { username: user, password: pass } });
    if (!res.ok) {
      setLoginErr(true);
      return;
    }
    setSignedIn(true);
    await refresh();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byTag = songs.filter((s) => {
      const ids = tagMap[s.id] ?? [];
      if (tagFilter === "all") return true;
      if (tagFilter === "none") return ids.length === 0;
      return ids.includes(tagFilter);
    });
    if (!q) return byTag;
    return byTag.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q),
    );
  }, [songs, query, tagMap, tagFilter]);

  const uploadOne = async (
    songTitle: string,
    songArtist: string,
    files: Partial<Record<ImportFileKey, File>>,
    tagIds: string[],
  ) => {
    const midi = files["midi"];
    if (!midi) throw new Error("缺少 MIDI");
    for (const field of STEM_FIELDS) if (!files[field.key]) throw new Error(`缺少 ${field.label}`);
    setBusy(`解析《${songTitle}》并生成四档谱面…`);
    const parsed = parseMidi(await midi.arrayBuffer());
    const charts = buildAllCharts(parsed, songTitle);
    const fingerprint = midiFingerprint(parsed);
    let durationMs = parsed.durationMs;
    for (const field of STEM_FIELDS) {
      const file = files[field.key];
      if (file) durationMs = Math.max(durationMs, await audioDurationMs(file));
    }
    const uploadFiles = [...STEM_FIELDS.map((field) => ({ key: field.key, file: files[field.key] })), { key: "midi" as const, file: midi }];
    const completeFiles = uploadFiles.filter((item): item is { key: ImportFileKey; file: File } => item.file instanceof File);
    const targets = await signUploads({
      data: {
        folder: songTitle.replace(/\s+/g, "-").toLowerCase(),
        files: completeFiles.map(({ key, file }) => ({ key, ext: file.name.split(".").pop() ?? (key === "midi" ? "mid" : "mp3") })),
      },
    });
    const paths: Record<string, string> = {};
    const sizes: Record<string, number> = {};
    for (let i = 0; i < targets.targets.length; i++) {
      const target = targets.targets[i];
      if (!target) continue;
      const source = completeFiles.find((item) => item.key === target.key)?.file;
      if (!source) throw new Error(`${target.key} 文件不存在`);
      setBusy(`上传《${songTitle}》${target.key}（${i + 1}/${targets.targets.length}）…`);
      const { error } = await supabase.storage.from("songs").uploadToSignedUrl(target.path, target.token, source);
      if (error) throw new Error(`${target.key} 上传失败：${error.message}`);
      paths[target.key] = target.path;
      sizes[target.key] = source.size;
    }
    const midiPath = paths["midi"];
    if (!midiPath) throw new Error("MIDI 上传结果缺失");
    setBusy(`写入《${songTitle}》…`);
    await save({ data: {
      title: songTitle,
      artist: songArtist.trim() || null,
      durationMs,
      bpm: Math.round(parsed.bpm * 100) / 100,
      tsNum: parsed.timeSignature[0],
      tsDen: parsed.timeSignature[1],
      fingerprint,
      paths: { vocals: paths["vocals"] ?? null, bass: paths["bass"] ?? null, drums: paths["drums"] ?? null, other: paths["other"] ?? null, midi: midiPath },
      sizes,
      charts: charts.map((chart) => ({ difficulty: chart.difficulty, chart: chart.chart })),
      tagIds,
    } });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const files = stemInputs.current;
    const midi = midiFile;
    if (!title.trim() || !midi) {
      setNote("请填写标题并选择鼓 MIDI");
      return;
    }
    const missing = STEM_FIELDS.filter((field) => !files[field.key]);
    if (missing.length) {
      setNote(`缺少分轨：${missing.map((item) => item.label).join("、")}`);
      return;
    }
    setNote(null);
    try {
      await uploadOne(title.trim(), artist, { ...files, midi }, uploadTags);
      setNote(`《${title.trim()}》已入库，四档谱面已生成`);
      setTitle("");
      setArtist("");
      setUploadTags([]);
      setMidiFile(null);
      stemInputs.current = {};
      setStemsPicked(0);
      await refresh();
    } catch (err) {
      setNote(`上传失败：${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const runBatch = async (onlyKey?: string) => {
    const queue = folderSongs.filter((song) => song.status !== "invalid" && song.status !== "done" && (!onlyKey || song.key === onlyKey));
    if (!queue.length) return;
    setBatchRunning(true);
    setNote(null);
    let completed = 0;
    for (const song of queue) {
      setFolderSongs((current) => current.map((item) => {
        if (item.key !== song.key) return item;
        const { error: _error, ...rest } = item;
        return { ...rest, status: "uploading" };
      }));
      try {
        await uploadOne(song.title.trim(), "", song.files, uploadTags);
        completed++;
        setFolderSongs((current) => current.map((item) => {
          if (item.key !== song.key) return item;
          const { error: _error, ...rest } = item;
          return { ...rest, status: "done" };
        }));
      } catch (error) {
        setFolderSongs((current) => current.map((item) => item.key === song.key ? { ...item, status: "failed", error: (error as Error).message } : item));
      }
    }
    setBatchRunning(false);
    setBusy(null);
    setNote(`批量导入完成：成功 ${completed} 首，失败 ${queue.length - completed} 首`);
    await refresh();
  };

  const regen = async (row: AdminSongRow) => {
    setBusy(`重新生成《${row.title}》谱面…`);
    try {
      const { url } = await midiUrlOf({ data: { id: row.id } });
      const buf = await (await fetch(url)).arrayBuffer();
      const parsed = parseMidi(buf);
      const charts = buildAllCharts(parsed, row.title);
      await regenerate({
        data: {
          songId: row.id,
          fingerprint: midiFingerprint(parsed),
          charts: charts.map((c) => ({ difficulty: c.difficulty, chart: c.chart })),
        },
      });
      setNote(`《${row.title}》四档谱面已重建`);
    } catch (err) {
      setNote(`重建失败：${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (signedIn === null) {
    return <div className="p-8 text-sm text-[var(--taiko-ink)]/60">载入中…</div>;
  }

  if (!signedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <form
          onSubmit={doLogin}
          className="w-full max-w-sm border border-[var(--taiko-line)] p-6"
        >
          <h1 className="mb-4 text-lg font-medium">歌曲后台</h1>
          <label className="mb-3 block text-xs text-[var(--taiko-ink)]/60">
            账号
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full border border-[var(--taiko-line)] bg-transparent px-3 py-2 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
            />
          </label>
          <label className="mb-5 block text-xs text-[var(--taiko-ink)]/60">
            密码
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full border border-[var(--taiko-line)] bg-transparent px-3 py-2 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
            />
          </label>
          {loginErr && <p className="mb-3 text-xs text-red-400">账号或密码不正确</p>}
          <button
            type="submit"
            className="w-full border border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] px-3 py-2 text-sm text-[var(--taiko-accent)]"
          >
            进入
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-medium">歌曲后台</h1>
        <button
          onClick={() => void logout().then(() => setSignedIn(false))}
          className="border border-[var(--taiko-line)] px-3 py-1.5 text-xs hover:border-[var(--taiko-accent)]"
        >
          退出后台
        </button>
      </header>

      {(busy || note) && (
        <div className="border border-[var(--taiko-line)] px-4 py-2 text-xs text-[var(--taiko-ink)]/80">
          {busy ?? note}
        </div>
      )}

      <section className="border border-[var(--taiko-line)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">导入文件夹</h2>
            <p className="mt-1 text-xs text-[var(--taiko-ink)]/50">
              文件名：歌名_vocals / bass / drums / other / midi，歌名可包含下划线
            </p>
          </div>
          <label className="cursor-pointer border border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] px-4 py-2 text-sm text-[var(--taiko-accent)]">
            选择文件夹
            <input
              ref={(input) => {
                if (input) input.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const result = groupImportFiles(Array.from(event.target.files ?? []));
                setFolderSongs(result.songs);
                setFolderIgnored(result.ignored);
                setNote(result.songs.length ? `识别到 ${result.songs.length} 首歌，请检查后开始导入` : "没有识别到符合命名规则的歌曲");
                event.target.value = "";
              }}
            />
          </label>
        </div>

        {folderSongs.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 grid grid-cols-[minmax(160px,1fr)_100px_220px] gap-3 border-b border-[var(--taiko-line)] pb-2 text-xs text-[var(--taiko-ink)]/45">
              <span>识别出的歌名</span><span>文件</span><span>状态</span>
            </div>
            <div className="max-h-72 overflow-y-auto taiko-scroll">
              {folderSongs.map((song) => (
                <div key={song.key} className="grid grid-cols-[minmax(160px,1fr)_100px_220px] items-center gap-3 border-b border-[var(--taiko-line)]/60 py-2 text-xs">
                  <input
                    value={song.title}
                    disabled={song.status === "uploading" || song.status === "done"}
                    onChange={(event) => setFolderSongs((current) => current.map((item) => item.key === song.key ? { ...item, title: event.target.value } : item))}
                    className="min-w-0 border border-[var(--taiko-line)] bg-transparent px-2 py-1.5 text-base outline-none focus:border-[var(--taiko-accent)] disabled:opacity-60"
                  />
                  <span className="tabular-nums text-[var(--taiko-ink)]/60">{Object.keys(song.files).length}/5</span>
                  <div className="flex min-w-0 items-center gap-2">
                    {song.status === "invalid" && <span className="text-red-400">{song.missing.length ? `缺 ${song.missing.join("、")}` : `重复 ${song.duplicates.join("、")}`}</span>}
                    {song.status === "ready" && <span className="text-[var(--taiko-accent)]">可以导入</span>}
                    {song.status === "uploading" && <span>正在导入…</span>}
                    {song.status === "done" && <span className="text-emerald-400">已完成</span>}
                    {song.status === "failed" && (
                      <>
                        <span className="min-w-0 flex-1 truncate text-red-400" title={song.error}>失败：{song.error}</span>
                        <button type="button" disabled={batchRunning} onClick={() => void runBatch(song.key)} className="shrink-0 border border-[var(--taiko-line)] px-2 py-1 hover:border-[var(--taiko-accent)] disabled:opacity-40">重试</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {folderIgnored.length > 0 && (
              <p className="mt-2 text-xs text-amber-300/80" title={folderIgnored.join("\n")}>另有 {folderIgnored.length} 个文件因后缀或格式无法识别</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={batchRunning || busy !== null || !folderSongs.some((song) => song.status === "ready" || song.status === "failed")}
                onClick={() => void runBatch()}
                className="border border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] px-4 py-2 text-sm text-[var(--taiko-accent)] disabled:opacity-40"
              >
                {batchRunning ? "正在逐首导入…" : "导入全部可用歌曲"}
              </button>
              <span className="text-xs text-[var(--taiko-ink)]/50">使用下方已选标签；歌曲将逐首处理，避免页面卡死</span>
            </div>
          </div>
        )}
      </section>

      <section className="border border-[var(--taiko-line)] p-4">
        <h2 className="mb-3 text-sm font-medium">上传新歌</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--taiko-ink)]/60">
              歌曲标题
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full border border-[var(--taiko-line)] bg-transparent px-3 py-2 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
              />
            </label>
            <label className="text-xs text-[var(--taiko-ink)]/60">
              艺人（可选）
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="mt-1 w-full border border-[var(--taiko-line)] bg-transparent px-3 py-2 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {STEM_FIELDS.map((f) => (
              <label key={f.key} className="text-xs text-[var(--taiko-ink)]/60">
                {f.label}
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    stemInputs.current[f.key] = e.target.files?.[0] ?? null;
                    setStemsPicked(
                      STEM_FIELDS.filter((s) => stemInputs.current[s.key]).length,
                    );
                  }}
                  className="mt-1 w-full border border-[var(--taiko-line)] px-2 py-1.5 text-xs"
                />
              </label>
            ))}
            <label className="text-xs text-[var(--taiko-ink)]/60">
              鼓 MIDI（.mid）
              <input
                type="file"
                accept=".mid,.midi"
                onChange={(e) => setMidiFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full border border-[var(--taiko-line)] px-2 py-1.5 text-xs"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--taiko-ink)]/60">
            <span>标签（可多选，不选为未分类）</span>
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setUploadTags((a) => toggleIn(a, t.id))}
                className={`border px-2 py-1 text-xs ${uploadTags.includes(t.id) ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] text-[var(--taiko-accent)]" : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60 hover:border-[var(--taiko-accent)]"}`}
              >
                {t.name}
              </button>
            ))}
            {!tags.length && <span className="text-[var(--taiko-ink)]/40">还没有标签，先在下方新建</span>}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy !== null}
              className="border border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] px-4 py-2 text-sm text-[var(--taiko-accent)] disabled:opacity-50"
            >
              上传并生成四档谱面
            </button>
            <span className="text-xs text-[var(--taiko-ink)]/50">
              已选分轨 {stemsPicked}/4 · MIDI {midiFile ? "已选" : "未选"}
            </span>
          </div>
        </form>
      </section>

      <section className="border border-[var(--taiko-line)] p-4">
        <h2 className="mb-3 text-sm font-medium">标签管理（{tags.length}）</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newTag.trim();
            if (!name) return;
            setNewTag("");
            void tagAction(() => addTag({ data: { name } }));
          }}
          className="mb-3 flex gap-2"
        >
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="新标签名，如：摇滚、热门"
            maxLength={40}
            className="w-64 border border-[var(--taiko-line)] bg-transparent px-3 py-1.5 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
          />
          <button
            type="submit"
            className="border border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] px-3 py-1.5 text-xs text-[var(--taiko-accent)]"
          >
            添加
          </button>
        </form>
        <div className="flex flex-col divide-y divide-[var(--taiko-line)]">
          {tags.map((t, i) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <input
                key={t.name}
                defaultValue={t.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== t.name) void tagAction(() => renTag({ data: { id: t.id, name: v } }));
                }}
                className="min-w-40 flex-1 border border-transparent bg-transparent px-1 py-0.5 text-base hover:border-[var(--taiko-line)] focus:border-[var(--taiko-accent)] focus:outline-none"
              />
              <span className="w-16 text-xs tabular-nums text-[var(--taiko-ink)]/50">{tagCount(t.id)} 首</span>
              <button onClick={() => moveTag(i, -1)} disabled={i === 0} className="border border-[var(--taiko-line)] px-2 py-1 text-xs disabled:opacity-30">上移</button>
              <button onClick={() => moveTag(i, 1)} disabled={i === tags.length - 1} className="border border-[var(--taiko-line)] px-2 py-1 text-xs disabled:opacity-30">下移</button>
              <button
                onClick={() => {
                  if (confirm(`删除标签「${t.name}」？歌曲本身会保留。`)) void tagAction(() => delTag({ data: { id: t.id } }));
                }}
                className="border border-[var(--taiko-line)] px-2 py-1 text-xs text-red-400 hover:border-red-400"
              >
                删除
              </button>
            </div>
          ))}
          {!tags.length && <p className="py-4 text-center text-xs text-[var(--taiko-ink)]/50">还没有标签</p>}
        </div>
      </section>

      <section className="border border-[var(--taiko-line)] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--taiko-ink)]/60">筛选：</span>
          {[{ id: "all", name: "全部" }, ...tags, { id: "none", name: "未分类" }].map((t) => (
            <button key={t.id} onClick={() => setTagFilter(t.id)} className={`border px-2 py-1 text-xs ${tagFilter === t.id ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] text-[var(--taiko-accent)]" : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60 hover:border-[var(--taiko-accent)]"}`}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">曲库（{songs.length}）</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索标题或艺人"
            className="w-56 border border-[var(--taiko-line)] bg-transparent px-3 py-1.5 text-base text-[var(--taiko-ink)] outline-none focus:border-[var(--taiko-accent)]"
          />
        </div>
        <div className="flex flex-col divide-y divide-[var(--taiko-line)]">
          {filtered.map((s) => (
            <div key={s.id} className="py-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input
                defaultValue={s.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== s.title) void update({ data: { id: s.id, title: v } }).then(refresh);
                }}
                className="min-w-40 flex-1 border border-transparent bg-transparent px-1 py-0.5 text-base hover:border-[var(--taiko-line)] focus:border-[var(--taiko-accent)] focus:outline-none"
              />
              <span className="text-xs tabular-nums text-[var(--taiko-ink)]/50">
                {fmtTime(s.duration_ms)} · BPM {Number(s.bpm)} · {s.ts_num}/{s.ts_den}
              </span>
              <button
                onClick={() => void update({ data: { id: s.id, published: !s.published } }).then(refresh)}
                className={`border px-2 py-1 text-xs ${
                  s.published
                    ? "border-[var(--taiko-accent)] text-[var(--taiko-accent)]"
                    : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60"
                }`}
              >
                {s.published ? "已上架" : "已下架"}
              </button>
              <button
                onClick={() => void regen(s)}
                disabled={busy !== null}
                className="border border-[var(--taiko-line)] px-2 py-1 text-xs hover:border-[var(--taiko-accent)] disabled:opacity-50"
              >
                重新生成谱面
              </button>
              <button
                onClick={() => {
                  if (confirm(`删除《${s.title}》？`)) void remove({ data: { id: s.id } }).then(refresh);
                }}
                className="border border-[var(--taiko-line)] px-2 py-1 text-xs text-red-400 hover:border-red-400"
              >
                删除
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1">
              {(tagMap[s.id] ?? []).map((id) => {
                const t = tags.find((x) => x.id === id);
                return t ? (
                  <span key={id} className="border border-[var(--taiko-accent)]/60 px-1.5 py-0.5 text-[11px] text-[var(--taiko-accent)]">{t.name}</span>
                ) : null;
              })}
              {!(tagMap[s.id] ?? []).length && <span className="text-[11px] text-[var(--taiko-ink)]/40">未分类</span>}
              <button
                onClick={() => setEditTagsOf(editTagsOf === s.id ? null : s.id)}
                className="px-1.5 py-0.5 text-[11px] text-[var(--taiko-ink)]/60 underline hover:text-[var(--taiko-accent)]"
              >
                {editTagsOf === s.id ? "完成" : "编辑标签"}
              </button>
            </div>
            {editTagsOf === s.id && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
                {tags.map((t) => {
                  const cur = tagMap[s.id] ?? [];
                  return (
                    <button
                      key={t.id}
                      onClick={() => void tagAction(() => linkTags({ data: { songId: s.id, tagIds: toggleIn(cur, t.id) } }))}
                      className={`border px-2 py-1 text-xs ${cur.includes(t.id) ? "border-[var(--taiko-accent)] bg-[var(--taiko-accent-soft)] text-[var(--taiko-accent)]" : "border-[var(--taiko-line)] text-[var(--taiko-ink)]/60 hover:border-[var(--taiko-accent)]"}`}
                    >
                      {t.name}
                    </button>
                  );
                })}
                {!tags.length && <span className="text-xs text-[var(--taiko-ink)]/40">先在上方新建标签</span>}
              </div>
            )}
            </div>
          ))}
          {!filtered.length && (
            <p className="py-6 text-center text-xs text-[var(--taiko-ink)]/50">
              {songs.length ? "没有匹配的歌曲" : "曲库还是空的，上传第一首吧"}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminScroll() {
  // 全站锁定了整页滚动（游戏画面需要），后台用独立滚动容器
  return (
    <div className="taiko-scroll h-screen overflow-y-auto" style={{ height: "100dvh" }}>
      <AdminPage />
    </div>
  );
}
