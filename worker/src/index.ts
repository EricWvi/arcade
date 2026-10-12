// The public arcade on Cloudflare. It speaks the same HTTP API as the Go
// server (internal/server), with GitHub sign-in, D1 for users, sessions,
// saves and plays, and R2 for the game files and the prebuilt catalogue.
// Static Assets serve the frontend; only /api/*, /auth/* and /games/*
// reach this Worker.

import { authenticate, handleAuth, sameOrigin, type User } from "./auth";
import { loadCatalog } from "./catalog";
import { serveGameFile } from "./files";
import { error, fresh, json } from "./http";
import { getRecentPlays, putPlay } from "./plays";
import { getSaves, putSaves } from "./saves";

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      console.error("request failed", request.method, new URL(request.url).pathname, err);
      return error(500, "服务器内部错误");
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const get = request.method === "GET" || request.method === "HEAD";

  if (pathname === "/api/version" && get) return json(200, { version: env.VERSION });
  const auth = handleAuth(request, url, env);
  if (auth) return auth;
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/games/")) return env.ASSETS.fetch(request);

  // Everything below needs a session, except /games/<key>, an app page.
  const isFile = /^\/games\/[^/]+\/(imgs|sources)\//.test(pathname);
  if (pathname.startsWith("/games/") && !isFile) return env.ASSETS.fetch(request);
  if (!sameOrigin(request, env)) return error(403, "请求来源不受信任");
  const pending = new Headers();
  const user = await authenticate(request, env, pending);
  const res = user ? await signedIn(request, url, env, user) : error(401, "未登录");
  for (const c of pending.getSetCookie()) res.headers.append("Set-Cookie", c);
  return res;
}

async function signedIn(request: Request, url: URL, env: Env, user: User): Promise<Response> {
  const { pathname } = url;
  if (pathname.startsWith("/games/")) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    return serveGameFile(request, url, env.GAMES);
  }
  const route = `${request.method} ${pathname}`;
  if (route === "GET /api/me") return fresh({ name: user.name, email: user.email });
  const catalog = await loadCatalog(env.GAMES);
  if (route === "GET /api/catalog") return fresh(catalog.listing);
  if (route === "GET /api/plays/recent") return getRecentPlays(env.DB, user, catalog);

  let m = /^\/api\/plays\/([^/]+)$/.exec(pathname);
  if (m && request.method === "PUT") return putPlay(request, env.DB, user, catalog, m[1]!);
  m = /^\/api\/games\/([^/]+)\/saves$/.exec(pathname);
  if (m && (request.method === "GET" || request.method === "PUT")) {
    const game = m[1]!;
    if (!catalog.games.has(game)) return error(404, "游戏不存在");
    return request.method === "GET" ? getSaves(env.DB, user, game) : putSaves(request, env.DB, user, game);
  }
  return error(404, "接口不存在");
}
