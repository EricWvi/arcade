import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { maxFileSaves } from "../src/saves";

const origin = "https://arcade.test";

// An uncompressed movie header with a 550x400 stage.
const swfHeader = "FWS\x08\x00\x00\x00\x00\x78\x00\x05\x5f\x00\x00\x0f\xa0\x00\x00\x0c\x01\x00";

const listing = {
  shelves: [
    {
      id: "zmxy",
      title: "造梦西游系列",
      games: [
        {
          id: "zmxy-1",
          title: "造梦西游",
          subtitle: "动作冒险",
          images: { card: "abc" },
          swf: { file: "game.swf", version: "def", width: 550, height: 400 },
          saves: "file",
        },
      ],
    },
  ],
};

beforeAll(async () => {
  await env.GAMES.put("catalog.json", JSON.stringify(listing));
  await env.GAMES.put("zmxy-1/imgs/card.png", "png");
  await env.GAMES.put("zmxy-1/imgs/notes.txt", "secret");
  await env.GAMES.put("zmxy-1/sources/game.swf", swfHeader);
  await env.GAMES.put("zmxy-1/sources/levels/1.swf", "level");
  await env.GAMES.put("zmxy-1/sources/page.html", "<script>");
  await env.GAMES.put("secret.swf", "secret");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return exports.default.fetch(new Request(origin + path, { ...init, headers, redirect: "manual" }));
}

/** Pretends GitHub answers for this user. */
function mockGitHub(user: object) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "gho_token" });
    if (url === "https://api.github.com/user") return Response.json(user);
    throw new Error(`unexpected fetch ${url}`);
  });
}

function cookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair = ""] = c.split(";");
    const i = pair.indexOf("=");
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

/** Signs in as a GitHub user and returns the session cookie header. */
async function signIn(id: number, login = `user${id}`, name: string | null = null): Promise<string> {
  const start = await request("/auth/login");
  const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
  mockGitHub({ id, login, name, email: null });
  const res = await request(`/auth/callback?code=c&state=${state}`, { cookie: `arcade_login=${cookies(start).arcade_login}` });
  expect(res.status).toBe(302);
  vi.restoreAllMocks();
  return `arcade_session=${cookies(res).arcade_session}`;
}

describe("auth", () => {
  it("serves the version without a session", async () => {
    const res = await request("/api/version");
    expect(await res.json()).toEqual({ version: "dev" });
  });

  it("requires a session for the API and game files", async () => {
    for (const path of ["/api/me", "/api/catalog", "/api/nope", "/games/zmxy-1/imgs/card.png", "/games/zmxy-1/sources/game.swf"]) {
      expect((await request(path)).status, path).toBe(401);
    }
    const res = await request("/api/me", { cookie: "arcade_session=unknown" });
    expect(res.status).toBe(401);
    expect(cookies(res).arcade_session).toBe("");
  });

  it("sends the browser to GitHub with a state cookie", async () => {
    const res = await request("/auth/login");
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("Location")!);
    expect(to.origin + to.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(to.searchParams.get("client_id")).toBe("client-id");
    expect(to.searchParams.get("redirect_uri")).toBe(`${origin}/auth/callback`);
    const login = res.headers.getSetCookie()[0]!;
    expect(login).toContain(`arcade_login=${to.searchParams.get("state")}`);
    expect(login).toContain("Path=/auth/");
    expect(login).toContain("Secure");
  });

  it("signs in with GitHub and keeps the user by numeric id", async () => {
    const start = await request("/auth/login");
    const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
    const github = mockGitHub({ id: 101, login: "octo", name: null, email: "octo@example.com" });
    const res = await request(`/auth/callback?code=the-code&state=${state}`, {
      cookie: `arcade_login=${cookies(start).arcade_login}`,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    const exchange = github.mock.calls[0]!;
    expect(JSON.parse(String(exchange[1]?.body))).toMatchObject({ code: "the-code", client_secret: "client-secret" });
    const session = `arcade_session=${cookies(res).arcade_session}`;
    expect(await (await request("/api/me", { cookie: session })).json()).toEqual({ name: "octo", email: "octo@example.com" });

    // A renamed account is still the same user.
    const again = await signIn(101, "octocat", "Octo Cat");
    expect(await (await request("/api/me", { cookie: again })).json()).toEqual({ name: "Octo Cat", email: "" });
    const { results } = await env.DB.prepare("SELECT issuer, subject FROM users WHERE subject = '101'").all();
    expect(results).toEqual([{ issuer: "https://github.com", subject: "101" }]);
  });

  it("rejects a callback without the matching state", async () => {
    const start = await request("/auth/login");
    const fetch = vi.spyOn(globalThis, "fetch");
    const res = await request("/auth/callback?code=c&state=forged", { cookie: `arcade_login=${cookies(start).arcade_login}` });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect((await request("/auth/callback?code=c&state=x")).status).toBe(400);
  });

  it("reports a denied or failed GitHub sign-in", async () => {
    const start = await request("/auth/login");
    const state = new URL(start.headers.get("Location")!).searchParams.get("state")!;
    const cookie = `arcade_login=${cookies(start).arcade_login}`;
    expect((await request(`/auth/callback?error=access_denied&state=${state}`, { cookie })).status).toBe(403);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "bad_verification_code" }));
    expect((await request(`/auth/callback?code=c&state=${state}`, { cookie })).status).toBe(502);
  });

  it("logs out only this session, and only from this site", async () => {
    const a = await signIn(102);
    const b = await signIn(102);
    expect((await request("/auth/logout", { method: "POST", cookie: a, headers: { Origin: "https://evil.test" } })).status).toBe(403);
    expect((await request("/auth/logout", { method: "POST", cookie: a, headers: { Origin: origin } })).status).toBe(204);
    expect((await request("/api/me", { cookie: a })).status).toBe(401);
    expect((await request("/api/me", { cookie: b })).status).toBe(200);
  });
});

describe("games", () => {
  it("serves the catalogue from R2", async () => {
    const cookie = await signIn(201);
    const res = await request("/api/catalog", { cookie });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(listing);
  });

  it("serves whitelisted game files", async () => {
    const cookie = await signIn(202);
    let res = await request("/games/zmxy-1/imgs/card.png?v=abc", { cookie });
    expect(res.status).toBe(200);
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("png");
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");

    res = await request("/games/zmxy-1/sources/levels/1.swf", { cookie });
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("level");
    expect(res.headers.get("Content-Type")).toBe("application/x-shockwave-flash");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");

    const etag = res.headers.get("ETag")!;
    res = await request("/games/zmxy-1/sources/levels/1.swf", { cookie, headers: { "If-None-Match": etag } });
    expect(res.status).toBe(304);

    // Last-Modified is to the second; R2 keeps milliseconds.
    const modified = Date.parse(res.headers.get("Last-Modified")!);
    for (const [since, status] of [[modified, 304], [modified - 1000, 200]] as const) {
      const headers = { "If-Modified-Since": new Date(since).toUTCString() };
      expect((await request("/games/zmxy-1/sources/levels/1.swf", { cookie, headers })).status).toBe(status);
    }

    res = await request("/games/zmxy-1/sources/game.swf", { cookie, headers: { Range: "bytes=0-2" } });
    expect(res.status).toBe(206);
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("FWS");
    const size = new TextEncoder().encode(swfHeader).byteLength;
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-2/${size}`);
    res = await request("/games/zmxy-1/sources/game.swf", { cookie, headers: { Range: "bytes=-4" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes ${size - 4}-${size - 1}/${size}`);

    for (const path of [
      "/games/zmxy-1/imgs/notes.txt",
      "/games/zmxy-1/imgs/missing.png",
      "/games/zmxy-1/sources/page.html",
      "/games/zmxy-1/sources/missing.swf",
      "/games/zmxy-1/sources/..%2F..%2Fsecret.swf",
      "/games/zmxy-1/sources/levels//1.swf",
      "/games/..%2Fzmxy-1/imgs/card.png",
      "/games/Zmxy-1/imgs/card.png",
    ]) {
      expect((await request(path, { cookie })).status, path).toBe(404);
    }
  });
});

describe("saves", () => {
  const put = (cookie: string, saves: Record<string, string | null>, game = "zmxy-1") =>
    request(`/api/games/${game}/saves`, { method: "PUT", cookie, body: JSON.stringify({ saves }) });

  it("writes, reads and deletes a user's saves", async () => {
    const cookie = await signIn(301);
    expect((await put(cookie, { 存档一: "a", slot2: "b" })).status).toBe(204);
    expect((await put(cookie, { slot2: null })).status).toBe(204);
    const res = await request("/api/games/zmxy-1/saves", { cookie });
    const body = await res.json<{ saves: object; updated: Record<string, number> }>();
    expect(body.saves).toEqual({ 存档一: "a" });
    expect(Math.abs(body.updated["存档一"]! - Date.now())).toBeLessThan(5000);

    const other = await signIn(302);
    expect(await (await request("/api/games/zmxy-1/saves", { cookie: other })).json()).toEqual({ saves: {}, updated: {} });
  });

  it("rejects unknown games and bad saves", async () => {
    const cookie = await signIn(303);
    expect((await put(cookie, { a: "1" }, "hot-air-1")).status).toBe(404);
    expect((await request("/api/games/zmxy-1/saves", { method: "PUT", cookie, body: "{" })).status).toBe(400);
    expect((await request("/api/games/zmxy-1/saves", { method: "PUT", cookie, body: '{"saves":{"a":1}}' })).status).toBe(400);
    expect((await put(cookie, {})).status).toBe(400);
    expect((await put(cookie, { "a\nb": "1" })).status).toBe(400);
    expect((await put(cookie, { a: "x".repeat((1 << 20) + 1) })).status).toBe(413);
  });

  it("caps how many saves a user keeps for a game", async () => {
    const cookie = await signIn(304);
    const full = Object.fromEntries(Array.from({ length: maxFileSaves }, (_, i) => [`save ${i}`, "x"]));
    expect((await put(cookie, full)).status).toBe(204);
    expect((await put(cookie, { "one more": "x" })).status).toBe(409);
    // Overwriting, or replacing one with another, is still fine.
    expect((await put(cookie, { "save 0": "y" })).status).toBe(204);
    expect((await put(cookie, { "save 0": null, "one more": "x" })).status).toBe(204);
  });

  it("refuses writes from other sites", async () => {
    const cookie = await signIn(305);
    const res = await request("/api/games/zmxy-1/saves", {
      method: "PUT",
      cookie,
      headers: { Origin: "https://evil.test" },
      body: JSON.stringify({ saves: { a: "1" } }),
    });
    expect(res.status).toBe(403);
  });
});

describe("plays", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const report = (cookie: string, body: object, playId = id) =>
    request(`/api/plays/${playId}`, { method: "PUT", cookie, body: JSON.stringify(body) });

  it("records plays and lists recent games", async () => {
    const cookie = await signIn(401);
    expect((await report(cookie, { game: "zmxy-1", activeMs: 1000, keys: 3, timezone: "Asia/Shanghai" })).status).toBe(204);
    expect((await report(cookie, { game: "zmxy-1", activeMs: 2000, keys: 2 })).status).toBe(204);
    const row = await env.DB.prepare("SELECT active_ms, keys FROM plays WHERE id = ?").bind(id).first();
    expect(row).toEqual({ active_ms: 2000, keys: 3 });

    const res = await request("/api/plays/recent", { cookie });
    const { games } = await res.json<{ games: { id: string; title: string; playedMs: number }[] }>();
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: "zmxy-1", title: "造梦西游", playedMs: 2000 });
  });

  it("caps active time by the time since the start", async () => {
    const cookie = await signIn(402);
    const playId = "1f8fad5b-d9cb-469f-a165-70867728950e";
    expect((await report(cookie, { game: "zmxy-1", activeMs: 3_600_000 }, playId)).status).toBe(204);
    const row = await env.DB.prepare("SELECT active_ms FROM plays WHERE id = ?").bind(playId).first<{ active_ms: number }>();
    expect(row!.active_ms).toBe(60_000);
  });

  it("keeps a play to its user", async () => {
    const owner = await signIn(403);
    const playId = "2f8fad5b-d9cb-469f-a165-70867728950e";
    expect((await report(owner, { game: "zmxy-1" }, playId)).status).toBe(204);
    expect((await report(await signIn(404), { game: "zmxy-1" }, playId)).status).toBe(409);
  });

  it("rejects malformed reports", async () => {
    const cookie = await signIn(405);
    expect((await report(cookie, { game: "zmxy-1" }, "not-a-uuid")).status).toBe(400);
    expect((await report(cookie, { game: "hot-air-1" })).status).toBe(404);
    expect((await report(cookie, { game: "zmxy-1", keys: -1 })).status).toBe(400);
    expect((await report(cookie, { game: "zmxy-1", keys: 1.5 })).status).toBe(400);
    expect((await report(cookie, { game: "zmxy-1", viewport: "big" })).status).toBe(400);
  });
});
