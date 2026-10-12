// Plays, as internal/server/plays.go and internal/store/plays.go.

import type { User } from "./auth";
import type { Catalog, ListedGame } from "./catalog";
import { byteLength, error, fresh, isObject, noContent, parseJSON, readBody } from "./http";

/** How many games the home page's recently played row shows. */
const recentLimit = 6;

/** A play id is a UUID made by the page when a game starts. */
const playID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const viewportSize = /^[0-9]{1,5}x[0-9]{1,5}$/;

/** How far active time may run ahead of the server's clock. */
const activeSlack = 60_000;

const counters = ["activeMs", "fullscreenMs", "keys", "clicks", "saveWrites"] as const;

/**
 * PUT /api/plays/<id> records a play's running totals. The first report
 * sets the start time; later ones move the end time while active time
 * grows. Active time is capped by the time since the start, so a page
 * cannot claim more. A play belongs to one user and game.
 */
export async function putPlay(request: Request, db: D1Database, user: User, catalog: Catalog, id: string): Promise<Response> {
  const text = await readBody(request, 4 << 10);
  const body = text === null ? undefined : parseJSON(text);
  if (!playID.test(id) || !isObject(body)) return error(400, "游玩记录格式不对");
  const { game = "", muted = false, timezone = "", viewport = "" } = body;
  if (typeof game !== "string" || typeof muted !== "boolean" || typeof timezone !== "string" || typeof viewport !== "string") {
    return error(400, "游玩记录格式不对");
  }
  const n: Record<(typeof counters)[number], number> = { activeMs: 0, fullscreenMs: 0, keys: 0, clicks: 0, saveWrites: 0 };
  for (const k of counters) {
    const v = body[k] ?? 0;
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return error(400, "游玩记录格式不对");
    n[k] = v;
  }
  if (!catalog.games.has(game)) return error(404, "游戏不存在");
  if (counters.some((k) => n[k] < 0) || byteLength(timezone) > 64 || (viewport !== "" && !viewportSize.test(viewport))) {
    return error(400, "游玩记录格式不对");
  }
  const ua = (request.headers.get("User-Agent") ?? "").slice(0, 512);

  // The update reads the reported values from the parameters, not
  // excluded.*: those are the insert's values, already capped for a first
  // report.
  const res = await db
    .prepare(
      `INSERT INTO plays (id, user_id, game, started_at, ended_at, active_ms, fullscreen_ms,
         keys, clicks, save_writes, muted, timezone, viewport, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?4, MIN(?5, ?13), MIN(?6, ?5, ?13), ?7, ?8, ?9, ?10, ?11, ?12, ?14)
       ON CONFLICT (id) DO UPDATE SET
         active_ms     = MAX(active_ms, MIN(?5, ?4 - started_at + ?13)),
         ended_at      = CASE WHEN MIN(?5, ?4 - started_at + ?13) > active_ms THEN ?4 ELSE ended_at END,
         fullscreen_ms = MAX(fullscreen_ms, MIN(?6, ?5, ?4 - started_at + ?13)),
         keys          = MAX(keys, excluded.keys),
         clicks        = MAX(clicks, excluded.clicks),
         save_writes   = MAX(save_writes, excluded.save_writes),
         muted         = excluded.muted,
         viewport      = excluded.viewport
       WHERE user_id = excluded.user_id AND game = excluded.game`,
    )
    .bind(id, user.id, game, Date.now(), n.activeMs, n.fullscreenMs, n.keys, n.clicks, n.saveWrites,
      muted ? 1 : 0, timezone, viewport, activeSlack, ua)
    .run();
  if (res.meta.changes === 0) return error(409, "游玩记录不属于这个游戏");
  return noContent();
}

/** GET /api/plays/recent lists the user's latest games still on a shelf. */
export async function getRecentPlays(db: D1Database, user: User, catalog: Catalog): Promise<Response> {
  // Removed games are skipped, so ask for more than needed.
  const { results } = await db
    .prepare(
      `SELECT game, MAX(ended_at) AS last, SUM(active_ms) AS active
       FROM plays WHERE user_id = ?
       GROUP BY game ORDER BY last DESC LIMIT 50`,
    )
    .bind(user.id)
    .all<{ game: string; last: number; active: number }>();
  const games: (ListedGame & { lastPlayedAt: number; playedMs: number })[] = [];
  for (const p of results) {
    const g = catalog.games.get(p.game);
    if (!g) continue;
    games.push({ ...g, lastPlayedAt: p.last, playedMs: p.active });
    if (games.length === recentLimit) break;
  }
  return fresh({ games });
}
