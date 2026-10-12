// Sign-in with GitHub and server-side sessions, as internal/auth does with
// OIDC on the homelab. GitHub user login is plain OAuth 2 (no ID token), so
// the user is whoever GET /user says the access token belongs to; their
// numeric id is the subject, since the login name can change.
//
// A session never expires on the server; it ends when the user signs out.

import { error } from "./http";

export interface User {
  id: number;
  name: string;
  email: string;
}

interface Identity {
  issuer: string;
  subject: string;
  name: string;
  email: string;
}

const sessionCookie = "arcade_session";
const loginCookie = "arcade_login";
// Browsers cap persistent cookies at 400 days, so the cookie is re-issued
// while in use to keep the session effectively permanent.
const cookieLifetime = 400 * 24 * 3600;
const refreshAfter = 24 * 3600;
const loginLifetime = 10 * 60;

export const githubIssuer = "https://github.com";
const authorizeURL = "https://github.com/login/oauth/authorize";
export const tokenURL = "https://github.com/login/oauth/access_token";
export const userURL = "https://api.github.com/user";

/**
 * Resolves the request's session to its user, or returns null. A cookie
 * for an unknown session is cleared and a live one re-issued once a day,
 * through the Set-Cookie headers added to pending.
 */
export async function authenticate(request: Request, env: Env, pending: Headers): Promise<User | null> {
  if (env.DEV_USER) return upsertUser(env.DB, { issuer: "dev", subject: env.DEV_USER, name: env.DEV_USER, email: "" });
  const token = cookie(request, sessionCookie);
  if (!token) return null;
  const hash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<User & { last_seen_at: number }>();
  const secure = isSecure(request);
  if (!row) {
    pending.append("Set-Cookie", clearCookie(sessionCookie, "/", secure));
    return null;
  }
  const now = unix();
  if (now - row.last_seen_at > refreshAfter) {
    await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).bind(now, hash).run();
    pending.append("Set-Cookie", sessionCookieValue(token, secure));
  }
  return { id: row.id, name: row.name, email: row.email };
}

/**
 * sameOrigin rejects state-changing requests sent from other sites,
 * including sibling subdomains that SameSite=Lax treats as same-site.
 */
export function sameOrigin(request: Request, env: Env): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method) || env.DEV_USER) return true;
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

/** Handles /auth/login, /auth/callback and /auth/logout, or returns null. */
export function handleAuth(request: Request, url: URL, env: Env): Promise<Response> | null {
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /auth/login") return Promise.resolve(login(url, env));
  if (route === "GET /auth/callback") return callback(request, url, env);
  if (route === "POST /auth/logout") return logout(request, env);
  return null;
}

function login(url: URL, env: Env): Response {
  if (env.DEV_USER) return Response.redirect(new URL("/", url).href, 302);
  const state = random(24);
  const target = new URL(authorizeURL);
  target.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL("/auth/callback", url).href,
    state,
    // No scope: the public profile is all that is needed.
    scope: "",
  }).toString();
  const headers = new Headers({ Location: target.href, "Cache-Control": "no-store" });
  headers.append("Set-Cookie", cookieString(loginCookie, state, "/auth/", loginLifetime, url.protocol === "https:"));
  return new Response(null, { status: 302, headers });
}

async function callback(request: Request, url: URL, env: Env): Promise<Response> {
  if (env.DEV_USER) return Response.redirect(new URL("/", url).href, 302);
  const secure = url.protocol === "https:";
  const clear = clearCookie(loginCookie, "/auth/", secure);
  const state = cookie(request, loginCookie);
  const q = url.searchParams;
  if (!state || !equal(q.get("state") ?? "", state)) {
    return page(400, "登录已过期或无效，请重新登录。", clear);
  }
  if (q.get("error")) {
    console.warn("github authorization denied", q.get("error"), q.get("error_description"));
    return page(403, "登录未完成。", clear);
  }
  let id: Identity;
  try {
    id = await identify(q.get("code") ?? "", new URL("/auth/callback", url).href, env);
  } catch (err) {
    console.error("github callback", err);
    return page(502, "无法完成登录，请重试。", clear);
  }
  const user = await upsertUser(env.DB, id);
  const token = random(32);
  const now = unix();
  await env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)`)
    .bind(await hashToken(token), user.id, now, now)
    .run();
  const headers = new Headers({ Location: "/", "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clear);
  headers.append("Set-Cookie", sessionCookieValue(token, secure));
  return new Response(null, { status: 302, headers });
}

/** Exchanges the code for an access token and asks GitHub whose it is. */
async function identify(code: string, redirectURI: string, env: Env): Promise<Identity> {
  const tokenRes = await fetch(tokenURL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectURI,
    }),
  });
  const token = await tokenRes.json<{ access_token?: string; error?: string }>();
  if (!tokenRes.ok || !token.access_token) throw new Error(`exchange code: ${tokenRes.status} ${token.error ?? ""}`);
  const userRes = await fetch(userURL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.access_token}`,
      "User-Agent": "arcade",
    },
  });
  if (!userRes.ok) throw new Error(`get user: ${userRes.status}`);
  const u = await userRes.json<{ id?: number; login?: string; name?: string | null; email?: string | null }>();
  if (typeof u.id !== "number") throw new Error("github user has no id");
  return { issuer: githubIssuer, subject: String(u.id), name: u.name || u.login || "", email: u.email ?? "" };
}

/** logout ends only this browser's session; the GitHub session stays. */
async function logout(request: Request, env: Env): Promise<Response> {
  if (!sameOrigin(request, env)) return error(403, "请求来源不受信任");
  const token = cookie(request, sessionCookie);
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await hashToken(token)).run();
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookie(sessionCookie, "/", isSecure(request)) },
  });
}

/**
 * Returns the user bound to the identity, creating it on first login and
 * refreshing the display attributes on later ones.
 */
async function upsertUser(db: D1Database, id: Identity): Promise<User> {
  const row = await db
    .prepare(
      `INSERT INTO users (issuer, subject, name, email) VALUES (?, ?, ?, ?)
       ON CONFLICT (issuer, subject) DO UPDATE SET name = excluded.name, email = excluded.email
       RETURNING id, name, email`,
    )
    .bind(id.issuer, id.subject, id.name, id.email)
    .first<User>();
  return row!;
}

const pageHTML = (msg: string) => `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Arcade</title>
<style>body{font:15px system-ui,sans-serif;background:#efede8;color:#3a3833;display:grid;place-items:center;min-height:100vh;margin:0}
@media (prefers-color-scheme:dark){body{background:#1f2226;color:#d4d6da}}a{color:inherit}</style>
<p>${msg} <a href="/auth/login">重新登录</a></p></html>`;

function page(status: number, msg: string, setCookie: string): Response {
  return new Response(pageHTML(msg), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Set-Cookie": setCookie },
  });
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
}

function cookieString(name: string, value: string, path: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

const sessionCookieValue = (token: string, secure: boolean) =>
  cookieString(sessionCookie, token, "/", cookieLifetime, secure);

const clearCookie = (name: string, path: string, secure: boolean) => cookieString(name, "", path, 0, secure);

const isSecure = (request: Request) => new URL(request.url).protocol === "https:";

const unix = () => Math.floor(Date.now() / 1000);

function random(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Only the hash of a session secret is stored. */
async function hashToken(token: string): Promise<string> {
  const sum = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(sum, (b) => b.toString(16).padStart(2, "0")).join("");
}

function equal(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}
