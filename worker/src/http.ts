// Response helpers shared by the handlers.

export function json(status: number, body: unknown, headers?: HeadersInit): Response {
  const res = Response.json(body, { status, headers });
  res.headers.set("Content-Type", "application/json; charset=utf-8");
  return res;
}

export const error = (status: number, msg: string) => json(status, { error: msg });

/** A JSON response that browsers must not cache. */
export const fresh = (body: unknown) => json(200, body, { "Cache-Control": "no-store" });

export const noContent = () => new Response(null, { status: 204 });

/** Reads a request body of at most max bytes, or returns null if it is larger. */
export async function readBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > max) return null;
  const raw = await request.arrayBuffer();
  if (raw.byteLength > max) return null;
  return new TextDecoder().decode(raw);
}

/** Parses JSON, or returns undefined if it is malformed. */
export function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;
