export type User = {
  name: string;
  email: string;
};

export type ImageKind = "icon" | "card" | "poster" | "background";

/** A game. Its id is its key: the directory under games_dir that holds its images. */
export type Game = {
  id: string;
  title: string;
  subtitle: string;
  /** Introduces the game, from games.yaml; line breaks matter. */
  description?: string;
  /** Version of each image that exists on the server; see gameImage. */
  images: Partial<Record<ImageKind, string>>;
  /** The movie to play, if the game can be played; see gameSource. */
  swf?: Swf;
  /** How the game keeps progress; see lib/saves.ts and lib/file-saves.ts. */
  saves?: "shared-object" | "file";
  /** How to play, from games.yaml; line breaks matter. */
  help?: string;
  /** Stands in for the images of mock games, which have none. */
  tint?: string;
};

/** A game's movie, under /games/<id>/sources/. */
export type Swf = {
  file: string;
  version: string;
  /** Stage size in pixels, or 0 if the server could not read it. */
  width: number;
  height: number;
};

/** A user's saved data for one game, by save name. */
export type Saves = Record<string, string>;

/** A game the user has played, for the recently played row. */
export type RecentGame = Game & {
  /** Unix milliseconds. */
  lastPlayedAt: number;
  /** Active play time over all plays. */
  playedMs: number;
};

/** A play's running totals; see trackPlay. */
export type PlayReport = {
  game: string;
  activeMs: number;
  fullscreenMs: number;
  keys: number;
  clicks: number;
  saveWrites: number;
  muted: boolean;
  timezone: string;
  viewport: string;
};

/** A home page row; games are in display order. */
export type Shelf = {
  id: string;
  title: string;
  games: Game[];
};

/** games.yaml as the home page needs it; shelves are in display order. */
export type Catalog = {
  shelves: Shelf[];
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const goToLogin = () => window.location.assign("/auth/login");

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      ...init,
    });
  } catch {
    throw new ApiError(0, "无法连接服务器");
  }
  if (res.status === 401) {
    goToLogin();
    throw new ApiError(401, "未登录");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, data?.error ?? `请求失败（${res.status}）`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<User>("GET", "/api/me"),
  catalog: () => request<Catalog>("GET", "/api/catalog"),
  /** The user's saves for a game, with when each was written (unix ms). */
  saves: (game: string) => request<{ saves: Saves; updated: Record<string, number> }>("GET", `/api/games/${game}/saves`),
  /** Writes the named saves; null deletes one. keepalive outlives the page. */
  putSaves: (game: string, saves: Record<string, string | null>, keepalive = false) =>
    request<void>("PUT", `/api/games/${game}/saves`, { saves }, { keepalive }),
  recentPlays: () => request<{ games: RecentGame[] }>("GET", "/api/plays/recent"),
  putPlay: (id: string, report: PlayReport, keepalive = false) =>
    request<void>("PUT", `/api/plays/${id}`, report, { keepalive }),
};

/** Ends this browser's session on the server. */
export async function logout() {
  let res: Response;
  try {
    res = await fetch("/auth/logout", { method: "POST", cache: "no-store" });
  } catch {
    throw new ApiError(0, "无法连接服务器，退出登录失败");
  }
  if (!res.ok) throw new ApiError(res.status, "退出登录失败");
}
