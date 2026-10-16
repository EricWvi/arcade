// The HTTP API both implementations serve: the Go server (internal/server)
// and the Cloudflare Worker (worker/src). The same suite runs against each
// (go.test.ts, worker.test.ts) with the catalogue in fixture/, signed in as
// the dev user "eric", so an API change has to land in both to pass.
//
// Sign-in itself differs (OIDC on the homelab, GitHub here) and is tested by
// each implementation's own tests.

import { describe, expect, it } from "vitest";

export interface Target {
  /** Sends a request to the server under test; path starts with "/". */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

const jsonType = "application/json; charset=utf-8";
const forever = "private, max-age=31536000, immutable";
const revalidate = "private, no-cache";

const errorBody = (error: string) => ({ error });

const zmxy = {
  id: "zmxy-1",
  title: "造梦西游",
  subtitle: "动作冒险",
  description: "西游题材的横版闯关。",
  images: { card: expect.any(String) },
  swf: { file: "game.swf", version: expect.any(String), width: 550, height: 400 },
  saves: "file",
  help: "方向键移动",
};

const hotAir = {
  id: "hot-air-1",
  title: "Hot Air",
  subtitle: "",
  images: {},
  swf: { file: "Hot_Air.swf", version: expect.any(String), width: 550, height: 400 },
  saves: "shared-object",
};

export function contract(target: Target) {
  const get = (path: string, headers?: HeadersInit) => target.fetch(path, { headers });
  const put = (path: string, body: unknown) =>
    target.fetch(path, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) });

  async function expectJSON(res: Response, status: number, body: unknown) {
    expect(res.status).toBe(status);
    expect(res.headers.get("Content-Type")).toBe(jsonType);
    expect(await res.json()).toEqual(body);
  }

  async function expectError(res: Response, status: number, msg: string) {
    await expectJSON(res, status, errorBody(msg));
  }

  describe("api", () => {
    it("GET /api/version", async () => {
      await expectJSON(await get("/api/version"), 200, { version: expect.any(String) });
    });

    it("GET /api/me", async () => {
      const res = await get("/api/me");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      await expectJSON(res, 200, { name: "eric", email: "" });
    });

    it("unknown endpoints", async () => {
      await expectError(await get("/api/nope"), 404, "接口不存在");
      await expectError(await target.fetch("/api/me", { method: "DELETE" }), 404, "接口不存在");
    });
  });

  describe("catalog", () => {
    it("GET /api/catalog lists the shelves in order", async () => {
      const res = await get("/api/catalog");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      await expectJSON(res, 200, {
        shelves: [
          { id: "zmxy", title: "造梦西游系列", games: [zmxy] },
          { id: "nitrome", title: "Nitrome", games: [hotAir] },
        ],
      });
    });
  });

  describe("game files", () => {
    async function expectFile(res: Response, type: string, cache: string, body: string) {
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(type);
      expect(res.headers.get("Cache-Control")).toBe(cache);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(body);
    }

    it("serves images", async () => {
      await expectFile(await get("/games/zmxy-1/imgs/card.png"), "image/png", revalidate, "png");
      await expectFile(await get("/games/zmxy-1/imgs/card.blur.webp?v=1"), "image/webp", forever, "webp");
    });

    it("serves sources", async () => {
      const swf = await get("/games/zmxy-1/sources/game.swf?v=1");
      expect(swf.headers.get("Content-Type")).toBe("application/x-shockwave-flash");
      expect(swf.headers.get("Cache-Control")).toBe(forever);
      await expectFile(await get("/games/zmxy-1/sources/levels/1.swf"), "application/x-shockwave-flash", revalidate, "level");
    });

    it("answers ranges and revalidation", async () => {
      const res = await get("/games/zmxy-1/sources/levels/1.swf", { Range: "bytes=1-3" });
      expect(res.status).toBe(206);
      expect(res.headers.get("Content-Range")).toBe("bytes 1-3/5");
      expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("eve");

      const first = await get("/games/zmxy-1/imgs/card.png");
      const modified = first.headers.get("Last-Modified");
      expect(modified).toBeTruthy();
      const again = await get("/games/zmxy-1/imgs/card.png", { "If-Modified-Since": modified! });
      expect(again.status).toBe(304);
    });

    it("serves nothing else", async () => {
      for (const path of [
        "/games/zmxy-1/imgs/notes.txt",
        "/games/zmxy-1/imgs/missing.png",
        "/games/zmxy-1/sources/page.html",
        "/games/zmxy-1/sources/missing.swf",
        "/games/zmxy-1/sources/levels",
        "/games/zmxy-1/sources/..%2F..%2Fhot-air-1%2Fsources%2FHot_Air.swf",
        "/games/..%2Fzmxy-1/imgs/card.png",
        "/games/Zmxy-1/imgs/card.png",
      ]) {
        expect((await get(path)).status, path).toBe(404);
      }
    });
  });

  describe("saves", () => {
    const path = "/api/games/zmxy-1/saves";

    it("writes, reads and deletes saves", async () => {
      await expectJSON(await get("/api/games/hot-air-1/saves"), 200, { saves: {}, updated: {} });
      expect((await put(path, { saves: { 存档一: "AL8A", slot2: "AL8B" } })).status).toBe(204);
      expect((await put(path, { saves: { slot2: null, 存档一: "AL8C" } })).status).toBe(204);
      const res = await get(path);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = await res.json<{ saves: object; updated: Record<string, number> }>();
      expect(body).toEqual({ saves: { 存档一: "AL8C" }, updated: { 存档一: expect.any(Number) } });
      // Unix milliseconds, to the second.
      expect(Math.abs(body.updated["存档一"]! - Date.now())).toBeLessThan(5000);
      expect(body.updated["存档一"]! % 1000).toBe(0);
    });

    it("rejects bad writes", async () => {
      const big = "x".repeat((1 << 20) + 1);
      await expectError(await put("/api/games/draft-1/saves", { saves: { a: "1" } }), 404, "游戏不存在");
      await expectError(await get("/api/games/unknown/saves"), 404, "游戏不存在");
      await expectError(await put(path, "not json"), 400, "存档格式不对");
      await expectError(await put(path, { saves: { a: 1 } }), 400, "存档格式不对");
      await expectError(await put(path, { saves: {} }), 400, "一次只能写 1 到 64 个存档");
      const batch = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`s${i}`, "x"]));
      await expectError(await put(path, { saves: batch }), 400, "一次只能写 1 到 64 个存档");
      await expectError(await put(path, { saves: { "a\nb": "1" } }), 400, "存档名不合法");
      await expectError(await put(path, { saves: { ["n".repeat(201)]: "1" } }), 400, "存档名不合法");
      await expectError(await put(path, { saves: { big } }), 413, "存档太大");
      // Within the per-save limit, over the whole body's.
      const saves = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, "x".repeat(1 << 20)]));
      await expectError(await put(path, { saves }), 413, "存档太大");
    });

    it("keeps at most 100 saves per game", async () => {
      const saves = "/api/games/hot-air-1/saves";
      for (let i = 0; i < 100; i += 50) {
        const batch = Object.fromEntries(Array.from({ length: 50 }, (_, j) => [`save ${i + j}`, "x"]));
        expect((await put(saves, { saves: batch })).status).toBe(204);
      }
      await expectError(await put(saves, { saves: { "one more": "x" } }), 409, "每个游戏最多保留 100 个存档，请先删除一些");
      expect((await put(saves, { saves: { "save 0": "y" } })).status).toBe(204);
      expect((await put(saves, { saves: { "save 0": null, "one more": "x" } })).status).toBe(204);
    });

    it("keeps at most 6 saves for a game that saves to files", async () => {
      const { saves: before } = await (await get(path)).json<{ saves: Record<string, string> }>();
      const clear = Object.fromEntries(Object.keys(before).map((name) => [name, null]));
      if (Object.keys(clear).length > 0) expect((await put(path, { saves: clear })).status).toBe(204);
      const seven = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`${i + 1}/孙悟空`, "x"]));
      await expectError(await put(path, { saves: seven }), 409, "每个游戏最多保留 6 个存档，请先删除一些");
      const { "7/孙悟空": _, ...six } = seven;
      expect((await put(path, { saves: six })).status).toBe(204);
      await expectError(await put(path, { saves: { "7/孙悟空": "x" } }), 409, "每个游戏最多保留 6 个存档，请先删除一些");
      // Saving over a slot replaces one save with another.
      expect((await put(path, { saves: { "1/孙悟空": null, "1/唐僧": "y" } })).status).toBe(204);
    });
  });

  describe("plays", () => {
    const report = (id: string, body: unknown) => put(`/api/plays/${id}`, body);

    it("records plays and lists recent games", async () => {
      const id = crypto.randomUUID();
      expect((await report(id, { game: "zmxy-1", activeMs: 1500, keys: 3, timezone: "Asia/Shanghai", viewport: "1440x900" })).status).toBe(204);
      expect((await report(id, { game: "zmxy-1", activeMs: 1000, keys: 2, muted: true })).status).toBe(204);
      const res = await get("/api/plays/recent");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      await expectJSON(res, 200, { games: [{ ...zmxy, lastPlayedAt: expect.any(Number), playedMs: 1500 }] });
    });

    it("keeps a play to its game", async () => {
      const id = crypto.randomUUID();
      expect((await report(id, { game: "hot-air-1" })).status).toBe(204);
      await expectError(await report(id, { game: "zmxy-1", activeMs: 10 }), 409, "游玩记录不属于这个游戏");
    });

    it("rejects bad reports", async () => {
      const id = crypto.randomUUID();
      await expectError(await report("not-a-uuid", { game: "zmxy-1" }), 400, "游玩记录格式不对");
      await expectError(await report(id, "not json"), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "zmxy-1", keys: -1 }), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "zmxy-1", keys: 1.5 }), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "zmxy-1", muted: "yes" }), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "zmxy-1", viewport: "big" }), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "zmxy-1", timezone: "z".repeat(65) }), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "zmxy-1", pad: "x".repeat(5000) }), 400, "游玩记录格式不对");
      await expectError(await report(id, { game: "unknown" }), 404, "游戏不存在");
      await expectError(await report(id, { game: "draft-1" }), 404, "游戏不存在");
    });
  });
}
