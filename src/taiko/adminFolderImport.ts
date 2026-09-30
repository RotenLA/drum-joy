export const IMPORT_STEM_KEYS = ["vocals", "bass", "drums", "other"] as const;
export type ImportStemKey = (typeof IMPORT_STEM_KEYS)[number];
/** metro = 节拍器基准轨（计时用）；original = 无后缀原曲（读歌名/歌手/封面） */
export type ImportFileKey = ImportStemKey | "midi" | "metro" | "original";

const SUFFIXES: Record<string, ImportFileKey> = {
  vocals: "vocals",
  vocal: "vocals",
  vox: "vocals",
  bass: "bass",
  drums: "drums",
  drum: "drums",
  other: "other",
  others: "other",
  inst: "other",
  midi: "midi",
  mid: "midi",
  metro: "metro",
  metronome: "metro",
  click: "metro",
};
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);
const MIDI_EXTENSIONS = new Set(["mid", "midi"]);

/** 分轨后缀分隔符：同时兼容「歌名 - Drums」「歌名_Drums」「歌名 Drums」 */
const SUFFIX_RE = /^(.*?)[\s_-]+([A-Za-z]+)$/;

export interface FolderImportSong {
  key: string;
  title: string;
  files: Partial<Record<ImportFileKey, File>>;
  duplicates: ImportFileKey[];
  missing: ImportFileKey[];
  status: "ready" | "invalid" | "uploading" | "done" | "review" | "failed";
  reviewBpm?: number;
  error?: string;
  /** 原曲内嵌信息读到的歌手 */
  artist?: string;
}

export interface FolderImportResult {
  songs: FolderImportSong[];
  ignored: string[];
}

/**
 * 按文件名末尾的分轨后缀归类，歌名本身可以包含空格、下划线与连字符。
 * 没有可识别后缀的音频文件视为原曲（用来读歌名、歌手、封面）。
 */
export function groupImportFiles(files: File[]): FolderImportResult {
  const groups = new Map<string, FolderImportSong>();
  const ignored: string[] = [];
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, "");
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const match = SUFFIX_RE.exec(base);
    const suffix = match ? SUFFIXES[match[2]!.toLowerCase()] : undefined;

    let key: ImportFileKey;
    let title: string;
    if (suffix) {
      key = suffix;
      title = match![1]!.trim();
    } else if (MIDI_EXTENSIONS.has(extension)) {
      key = "midi";
      title = base.trim();
    } else if (AUDIO_EXTENSIONS.has(extension)) {
      key = "original";
      title = base.trim();
    } else {
      ignored.push(file.name);
      continue;
    }

    const validFormat =
      key === "midi" ? MIDI_EXTENSIONS.has(extension) : AUDIO_EXTENSIONS.has(extension);
    if (!title || !validFormat) {
      ignored.push(file.name);
      continue;
    }

    const normalized = title.toLocaleLowerCase();
    const group = groups.get(normalized) ?? {
      key: normalized,
      title,
      files: {},
      duplicates: [],
      missing: [],
      status: "ready" as const,
    };
    if (group.files[key]) group.duplicates.push(key);
    else group.files[key] = file;
    groups.set(normalized, group);
  }

  const required: ImportFileKey[] = [...IMPORT_STEM_KEYS, "midi"];
  const songs = [...groups.values()]
    .map((song) => {
      const missing = required.filter((key) => !song.files[key]);
      return {
        ...song,
        missing,
        status: missing.length || song.duplicates.length ? ("invalid" as const) : ("ready" as const),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  return { songs, ignored };
}
