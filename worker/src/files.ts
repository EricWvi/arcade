// Game images and sources from the GAMES bucket, stored under the same
// paths as on the homelab's disk: <key>/imgs/<name>, <key>/sources/<path>.
// The whitelists mirror internal/catalog/listing.go.

import { validKey } from "./catalog";

const imageName = /^[a-z0-9]+(-[a-z0-9]+)*(\.blur)?\.(png|jpe?g|webp)$/;

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const sourceTypes: Record<string, string> = {
  ".swf": "application/x-shockwave-flash",
  ".xml": "text/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
};

const notFound = () => new Response("404 page not found\n", { status: 404 });

/** Serves GET /games/<key>/imgs/<name> and /games/<key>/sources/<path>. */
export async function serveGameFile(request: Request, url: URL, bucket: R2Bucket): Promise<Response> {
  const m = /^\/games\/([^/]+)\/(imgs|sources)\/(.+)$/.exec(url.pathname);
  const [, key = "", dir, rest = ""] = m ?? [];
  if (!validKey(key)) return notFound();
  if (dir === "imgs") {
    if (!imageName.test(rest)) return notFound();
    const type = imageTypes[rest.slice(rest.lastIndexOf(".") + 1)]!;
    return serveObject(request, url, bucket, `${key}/imgs/${rest}`, type);
  }
  const path = sourcePath(rest);
  const name = path?.slice(path.lastIndexOf("/") + 1) ?? "";
  const type = name.includes(".") ? sourceTypes[name.slice(name.lastIndexOf(".")).toLowerCase()] : undefined;
  if (!path || !type) return notFound();
  return serveObject(request, url, bucket, `${key}/sources/${path}`, type);
}

/**
 * Decodes a sources path. Like os.Root on the homelab, it may not climb out
 * of the sources directory: no empty, "." or ".." segments.
 */
function sourcePath(raw: string): string | null {
  const segments: string[] = [];
  for (const s of raw.split("/")) {
    let seg: string;
    try {
      seg = decodeURIComponent(s);
    } catch {
      return null;
    }
    if (seg === "" || seg === "." || seg === ".." || /[/\\\0]/.test(seg)) return null;
    segments.push(seg);
  }
  return segments.join("/");
}

async function serveObject(request: Request, url: URL, bucket: R2Bucket, key: string, type: string): Promise<Response> {
  let obj: R2Object | null;
  try {
    obj = await bucket.get(key, { range: request.headers, onlyIf: conditions(request.headers) });
  } catch {
    // An unsatisfiable Range.
    return new Response(null, { status: 416 });
  }
  if (!obj) return notFound();

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Content-Type", type);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("ETag", obj.httpEtag);
  headers.set("Last-Modified", obj.uploaded.toUTCString());
  headers.set("Accept-Ranges", "bytes");
  // A versioned URL (?v=, from the catalogue) changes with the file and is
  // kept forever; a bare one is revalidated on every use.
  headers.set("Cache-Control", url.searchParams.has("v") ? "private, max-age=31536000, immutable" : "private, no-cache");

  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  const body = request.method === "HEAD" ? null : (obj as R2ObjectBody).body;
  // R2 may report a range with every key present, some undefined.
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!range || !request.headers.has("Range")) return new Response(body, { headers });
  let offset: number;
  let length: number;
  if (range.suffix !== undefined) {
    length = Math.min(range.suffix, obj.size);
    offset = obj.size - length;
  } else {
    offset = range.offset ?? 0;
    length = range.length ?? obj.size - offset;
  }
  headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
  return new Response(body, { status: 206, headers });
}

/**
 * Turns a revalidation into an R2 condition. If-Modified-Since is compared
 * to the second, as Last-Modified is sent, though R2 keeps milliseconds.
 */
function conditions(headers: Headers): R2Conditional | undefined {
  const etag = headers.get("If-None-Match");
  if (etag) return { etagDoesNotMatch: etag.replace(/^W\//, "").replaceAll('"', "") };
  const since = Date.parse(headers.get("If-Modified-Since") ?? "");
  if (!Number.isNaN(since)) return { uploadedAfter: new Date(since + 999) };
}
