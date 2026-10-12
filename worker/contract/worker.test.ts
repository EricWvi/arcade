import { env, exports } from "cloudflare:workers";
import { beforeAll, inject } from "vitest";
import { contract } from "./api";

beforeAll(async () => {
  for (const [key, b64] of Object.entries(inject("published"))) {
    await env.GAMES.put(key, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  }
});

contract({ fetch: (path, init) => exports.default.fetch(new Request(`http://arcade.test${path}`, init)) });
