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
  component: AdminPage,
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

  const refresh = useCallback(async () => {
    const res = await list();
    setSongs(res.songs as AdminSongRow[]);
  }, [list]);

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
    if (!q) return songs;
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || (s.artist ?? "").toLowerCase().includes(q),
    );
  }, [songs, query]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const files = stemInputs.current;
    const midi = midiFile;
    if (!title.trim() || !midi) {
      setNote("请填写标题并选择鼓 MIDI");
      return;
    }
    const missing = STEM_FIELDS.filter((f) => !files[f.key]);
    if (missing.length) {
      setNote(`缺少分轨：${missing.map((m) => m.label).join("、")}`);
      return;
    }
    setBusy("准备上传…");
    setNote(null);
    try {
      // 1. 解析 MIDI，生成四档谱面
      setBusy("解析 MIDI 并生成四档谱面…");
      const midiBuf = await midi.arrayBuffer();
      const parsed = parseMidi(midiBuf);
      const charts = buildAllCharts(parsed, title.trim());
      const fingerprint = midiFingerprint(parsed);

      // 2. 时长（取最长的一条分轨）
      setBusy("读取音频时长…");
      let durationMs = parsed.durationMs;
      for (const f of STEM_FIELDS) {
        const file = files[f.key];
        if (!file) continue;
        durationMs = Math.max(durationMs, await audioDurationMs(file));
      }

      // 3. 申请上传直链并直传
      const targets = await signUploads({
        data: {
          folder: title.trim().replace(/\s+/g, "-").toLowerCase(),
          files: [
            ...STEM_FIELDS.map((f) => ({ key: f.key, ext: (files[f.key]!.name.split(".").pop() ?? "mp3") })),
            { key: "midi", ext: midi.name.split(".").pop() ?? "mid" },
          ],
        },
      });

      const paths: Record<string, string> = {};
      const sizes: Record<string, number> = {};
      let idx = 0;
      for (const t of targets.targets) {
        idx++;
        const file = t.key === "midi" ? midi : files[t.key]!;
        setBusy(`上传 ${t.key}（${idx}/${targets.targets.length}）…`);
        const { error } = await supabase.storage
          .from("songs")
          .uploadToSignedUrl(t.path, t.token, file);
        if (error) throw new Error(`${t.key} 上传失败：${error.message}`);
        paths[t.key] = t.path;
        sizes[t.key] = file.size;
      }

      // 4. 入库
      setBusy("写入曲库…");
      await save({
        data: {
          title: title.trim(),
          artist: artist.trim() || null,
          durationMs,
          bpm: Math.round(parsed.bpm * 100) / 100,
          tsNum: parsed.timeSignature[0],
          tsDen: parsed.timeSignature[1],
          fingerprint,
          paths: {
            vocals: paths["vocals"] ?? null,
            bass: paths["bass"] ?? null,
            drums: paths["drums"] ?? null,
            other: paths["other"] ?? null,
            midi: paths["midi"]!,
          },
          sizes,
          charts: charts.map((c) => ({ difficulty: c.difficulty, chart: c.chart })),
        },
      });
      setNote(`《${title.trim()}》已入库，四档谱面已生成`);
      setTitle("");
      setArtist("");
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
            <div key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
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
