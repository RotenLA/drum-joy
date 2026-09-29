export const IMPORT_STEM_KEYS = ["vocals", "bass", "drums", "other"] as const;
export type ImportStemKey = (typeof IMPORT_STEM_KEYS)[number];
export type ImportFileKey = ImportStemKey | "midi";

const SUFFIXES: Record<string, ImportFileKey> = {
  vocals: "vocals",
  vocal: "vocals",
  vox: "vocals",
  bass: "bass",
  drums: "drums",
  drum: "drums",
  other: "other",
  midi: "midi",
};

export interface FolderImportSong {
  key: string;
  title: string;
  files: Partial<Record<ImportFileKey, File>>;
  duplicates: ImportFileKey[];
  missing: ImportFileKey[];
  status: "ready" | "invalid" | "uploading" | "done" | "failed";
  error?: string;
}

export interface FolderImportResult {
  songs: FolderImportSong[];
  ignored: string[];
}

/** 按最后一个下划线识别分轨；歌名本身可包含下划线。 */
export function groupImportFiles(files: File[]): FolderImportResult {
  const groups = new Map<string, FolderImportSong>();
  const ignored: string[] = [];
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, "");
    const split = base.lastIndexOf("_");
    if (split <= 0) {
      ignored.push(file.name);
      continue;
    }
    const key = SUFFIXES[base.slice(split + 1).toLowerCase()];
    if (!key) {
      ignored.push(file.name);
      continue;
    }
    const title = base.slice(0, split).trim();
    if (!title || (key === "midi" && !/\.midi?$/i.test(file.name))) {
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
        status: missing.length || song.duplicates.length ? "invalid" as const : "ready" as const,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  return { songs, ignored };
}