// A user's saves per game, as internal/server/saves.go, plus a cap on how
// many a user may keep for one game: the site is public, and save names
// are otherwise free.

import type { User } from "./auth";
import { byteLength, error, fresh, isObject, noContent, parseJSON, readBody } from "./http";

// Flash allowed 100 KB per SharedObject by default, so these leave plenty
// of room.
const maxSaveName = 200;
const maxSaveData = 1 << 20;
const maxSaveBatch = 64;
const maxSaveBody = 8 << 20;
export const maxSavesPerGame = 100;

/** GET /api/games/<key>/saves */
export async function getSaves(db: D1Database, user: User, game: string): Promise<Response> {
  const { results } = await db
    .prepare(
      `SELECT name, data, updated_at FROM saves WHERE user_id = ? AND game = ?
       ORDER BY updated_at DESC, name`,
    )
    .bind(user.id, game)
    .all<{ name: string; data: string; updated_at: number }>();
  const saves: Record<string, string> = {};
  const updated: Record<string, number> = {};
  for (const sv of results) {
    saves[sv.name] = sv.data;
    updated[sv.name] = sv.updated_at * 1000;
  }
  return fresh({ saves, updated });
}

/** PUT /api/games/<key>/saves writes the saves named and leaves the rest. */
export async function putSaves(request: Request, db: D1Database, user: User, game: string): Promise<Response> {
  const text = await readBody(request, maxSaveBody);
  if (text === null) return error(413, "存档太大");
  const body = parseJSON(text);
  const saves = isObject(body) ? body.saves : undefined;
  if (!isObject(saves) || !Object.values(saves).every((v) => v === null || typeof v === "string")) {
    return error(400, "存档格式不对");
  }
  const entries = Object.entries(saves as Record<string, string | null>);
  if (entries.length === 0 || entries.length > maxSaveBatch) return error(400, "一次只能写 1 到 64 个存档");
  for (const [name, data] of entries) {
    if (!validSaveName(name)) return error(400, "存档名不合法");
    if (data !== null && byteLength(data) > maxSaveData) return error(413, "存档太大");
  }

  const { results } = await db
    .prepare(`SELECT name FROM saves WHERE user_id = ? AND game = ?`)
    .bind(user.id, game)
    .all<{ name: string }>();
  const names = new Set(results.map((r) => r.name));
  const before = names.size;
  for (const [name, data] of entries) data === null ? names.delete(name) : names.add(name);
  if (names.size > maxSavesPerGame && names.size > before) {
    return error(409, `每个游戏最多保留 ${maxSavesPerGame} 个存档，请先删除一些`);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.batch(
    entries.map(([name, data]) =>
      data === null
        ? db.prepare(`DELETE FROM saves WHERE user_id = ? AND game = ? AND name = ?`).bind(user.id, game, name)
        : db
            .prepare(
              `INSERT INTO saves (user_id, game, name, data, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (user_id, game, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
            )
            .bind(user.id, game, name, data, now),
    ),
  );
  return noContent();
}

// Go's unicode.IsPrint: letters, marks, numbers, punctuation, symbols and
// the ASCII space.
const printable = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]+$/u;

/** Names come from the game (a SharedObject's name and path), so any printable text goes. */
const validSaveName = (name: string) => byteLength(name) <= maxSaveName && printable.test(name);
