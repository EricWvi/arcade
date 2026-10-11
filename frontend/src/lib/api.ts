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
  /** Image kinds that exist on the server; see gameImage. */
  images: ImageKind[];
  /** Stands in for the images of mock games, which have none. */
  tint?: string;
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

async function request<T>(method: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, cache: "no-store" });
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
