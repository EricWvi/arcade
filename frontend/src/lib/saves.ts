import { api, type Saves } from "@/lib/api";

/*
 * Keeps a Flash game's saves on the server. Ruffle stores each SharedObject
 * in localStorage as base64 under "<host><swf path>/<name>", so the default
 * sync works for any game that saves that way, without knowing what is in
 * the saves. Only the name goes to the server, so saves survive a change of
 * host (localhost → the real domain) or of the swf's path.
 */

const syncEvery = 2000;

/** The localStorage prefix Ruffle uses for the movie at url. */
export const sharedObjectPrefix = (url: string) => {
  const u = new URL(url, window.location.href);
  return `${u.hostname}${u.pathname}/`;
};

/** This game's saves currently in localStorage, by name. */
function readLocal(prefix: string): Saves {
  const saves: Saves = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) saves[key.slice(prefix.length)] = value;
  }
  return saves;
}

/** What changed from before to now; null marks a deleted save. */
function diff(before: Saves, now: Saves) {
  const changes: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(now)) if (before[name] !== value) changes[name] = value;
  for (const name of Object.keys(before)) if (!(name in now)) changes[name] = null;
  return changes;
}

/**
 * Restores the server's saves into localStorage before the movie starts,
 * so they win over whatever this browser had. Saves only this browser has,
 * such as progress from before syncing existed, are uploaded instead.
 * Returns what both sides now agree on, for syncSaves.
 */
export async function restoreSaves(game: string, prefix: string): Promise<Saves> {
  const { saves } = await api.saves(game);
  for (const [name, value] of Object.entries(saves)) localStorage.setItem(prefix + name, value);
  const local = readLocal(prefix);
  const extra = Object.fromEntries(Object.entries(local).filter(([name]) => !(name in saves)));
  if (Object.keys(extra).length > 0) await api.putSaves(game, extra);
  return local;
}

/**
 * Uploads whatever the game writes to its saves, checking every couple of
 * seconds and once more when the page is hidden or the game closes. A
 * failed upload is retried on the next check. Returns a function that stops
 * syncing after a last upload.
 */
export function syncSaves(game: string, prefix: string, synced: Saves): () => void {
  let busy = false;
  // keepalive uploads skip the queue: the page may be going away.
  const upload = (keepalive = false) => {
    if (busy && !keepalive) return;
    const now = readLocal(prefix);
    const changes = diff(synced, now);
    if (Object.keys(changes).length === 0) return;
    busy = true;
    api
      .putSaves(game, changes, keepalive)
      .then(() => {
        synced = now;
      })
      .catch((err: unknown) => console.warn("upload saves", err))
      .finally(() => {
        busy = false;
      });
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") upload(true);
  };
  const onPageHide = () => upload(true);

  const timer = window.setInterval(upload, syncEvery);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    upload(true);
  };
}
