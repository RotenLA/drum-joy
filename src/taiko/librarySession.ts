import { getLibraryRevision, listLibrarySongs, type LibrarySong, type LibraryTag } from "@/lib/songs.functions";

const SNAPSHOT_KEY = "taiko.library.snapshot.v1";

export interface LibrarySnapshot {
  version: number;
  songs: LibrarySong[];
  tags: LibraryTag[];
}

let sessionSnapshot: LibrarySnapshot | null = null;
let sessionPromise: Promise<LibrarySnapshot> | null = null;

function readSnapshot(): LibrarySnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "null") as Partial<LibrarySnapshot> | null;
    if (!parsed || typeof parsed.version !== "number" || !Array.isArray(parsed.songs) || !Array.isArray(parsed.tags)) return null;
    return { version: parsed.version, songs: parsed.songs, tags: parsed.tags };
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: LibrarySnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // 存储不可用时，本次会话仍复用内存快照。
  }
}

export function currentLibrarySnapshot(): LibrarySnapshot | null {
  return sessionSnapshot ?? readSnapshot();
}

/** 每次页面会话只执行一次版本校验；游戏内返回只复用结果。 */
export function loadLibraryOnce(): Promise<LibrarySnapshot> {
  if (sessionSnapshot) return Promise.resolve(sessionSnapshot);
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const cached = readSnapshot();
    try {
      const { version } = await getLibraryRevision();
      if (cached && cached.version === version) {
        sessionSnapshot = cached;
        return cached;
      }
      const fresh = await listLibrarySongs();
      const snapshot = { version, songs: fresh.songs, tags: fresh.tags };
      sessionSnapshot = snapshot;
      writeSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      if (cached) {
        sessionSnapshot = cached;
        return cached;
      }
      sessionPromise = null;
      throw error;
    }
  })();
  return sessionPromise;
}