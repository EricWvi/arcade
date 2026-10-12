// The catalogue is catalog.json in the GAMES bucket, written ahead of time
// by `arcade catalog build` (internal/catalog/listing.go): the
// GET /api/catalog response, with each game's images and movie already
// looked up.

/** catalog.Listing */
export interface Listing {
  shelves: { id: string; title: string; games: ListedGame[] }[];
}

/** catalog.ListedGame */
export interface ListedGame {
  id: string;
  title: string;
  subtitle: string;
  description?: string;
  images: Record<string, string>;
  swf?: { file: string; version: string; width: number; height: number };
  saves: string;
  help?: string;
}

export interface Catalog {
  listing: Listing;
  /** Every game on a shelf, by key. Only these can be played and saved. */
  games: Map<string, ListedGame>;
}

export const catalogKey = "catalog.json";

/** How long an isolate trusts its copy before asking R2 whether it changed. */
const recheckAfter = 60_000;

let cached: { catalog: Catalog; etag: string; checkedAt: number } | undefined;

/**
 * Returns the catalogue, empty if none has been uploaded. Publishing a new
 * one takes effect within a minute, with no deploy.
 */
export async function loadCatalog(bucket: R2Bucket, now = Date.now()): Promise<Catalog> {
  if (cached && now - cached.checkedAt < recheckAfter) return cached.catalog;
  const obj = await bucket.get(catalogKey, cached ? { onlyIf: { etagDoesNotMatch: cached.etag } } : {});
  if (!obj) {
    cached = undefined;
    return index({ shelves: [] });
  }
  if (cached && !("body" in obj)) {
    cached.checkedAt = now;
    return cached.catalog;
  }
  const catalog = index(await (obj as R2ObjectBody).json<Listing>());
  cached = { catalog, etag: obj.etag, checkedAt: now };
  return catalog;
}

/** Forgets the cached catalogue; for tests. */
export function forgetCatalog() {
  cached = undefined;
}

function index(listing: Listing): Catalog {
  const games = new Map<string, ListedGame>();
  for (const shelf of listing.shelves) for (const g of shelf.games) games.set(g.id, g);
  return { listing, games };
}

const keyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** catalog.ValidKey */
export const validKey = (key: string) => keyPattern.test(key);
