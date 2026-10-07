import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * The app's front door (used by proxy.ts for every request): who may come in, from where, how
 * often and with how much data. Plain functions with the environment and clock passed in, so the
 * tests can cover every case.
 *
 *  - Password: APP_PASSWORD (any user name). A live build refuses to run open unless APP_OPEN=yes,
 *    and wants a password of at least 12 characters.
 *  - Wrong passwords: 10 tries per address in 15 minutes, then that address waits.
 *  - Other sites can't make your browser act for you (CSRF): changes must come from this app's own pages.
 *  - Expensive actions (searches, reading a client's site, PDFs) have a per-address rate limit,
 *    and every request has a size limit.
 *  - Meta's webhook, the unsubscribe link and a client's handoff page stay public (they check their own
 *    signatures), but rate limited.
 */

export type Env = Record<string, string | undefined>;

/** A live build (hosted or `npm start`), not `npm run dev` or the tests. */
export const liveBuild = (env: Env = process.env) =>
  env.NODE_ENV === "production" || !!env.VERCEL || !!env.RENDER || !!env.FLY_APP_NAME || !!env.RAILWAY_ENVIRONMENT;

const yes = (v?: string) => /^(1|on|true|yes)$/i.test(v?.trim() ?? "");

export const MIN_PASSWORD = 12;

/** Why the app won't open, or undefined when the password setup is fine. */
export function passwordProblem(env: Env = process.env): string | undefined {
  if (!liveBuild(env) || yes(env.APP_OPEN)) return undefined;
  const p = env.APP_PASSWORD ?? "";
  if (!p) return "This app is online without a password. Set APP_PASSWORD in your host's settings (saved searches hold phone numbers and emails, and every search spends your API quota), or APP_OPEN=yes if it really should be open.";
  if (p.length < MIN_PASSWORD) return `APP_PASSWORD is too short for an app on the internet: use at least ${MIN_PASSWORD} characters.`;
  return undefined;
}

/** Equal strings, compared in constant time (hashing first so different lengths leak nothing either). */
export function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(h(a), h(b));
}

/** The password from a Basic `Authorization` header (the user name is ignored). */
export function basicPassword(header: string | null): string | undefined {
  if (!header?.startsWith("Basic ")) return undefined;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    return i < 0 ? undefined : decoded.slice(i + 1);
  } catch {
    return undefined;
  }
}

/**
 * The visitor's address. Behind a host's proxy (Render, Fly, Railway, nginx…) the real one is the
 * last entry the proxy added to X-Forwarded-For; TRUST_PROXY_HOPS says how many proxies there are
 * (default 1). Earlier entries can be typed by anyone, so they're never trusted.
 */
export function clientIp(headers: Headers, env: Env = process.env): string {
  const hops = Math.max(1, Math.min(5, Number(env.TRUST_PROXY_HOPS) || 1));
  const xff = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff[Math.max(0, xff.length - hops)] || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Fixed-window counter per key (an address, or address + action). Memory only: one server. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(readonly limit: number, readonly windowMs: number, private now: () => number = Date.now) {}

  /** Count one more; ok=false once over the limit, with seconds until it resets. */
  take(key: string): { ok: boolean; retryAfter: number } {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || e.reset <= t) {
      if (this.hits.size > 10_000) this.prune(t);
      e = { n: 0, reset: t + this.windowMs };
      this.hits.set(key, e);
    }
    e.n++;
    return { ok: e.n <= this.limit, retryAfter: Math.ceil((e.reset - t) / 1000) };
  }

  /** Over the limit right now, without counting. */
  blocked(key: string): { blocked: boolean; retryAfter: number } {
    const t = this.now();
    const e = this.hits.get(key);
    return e && e.reset > t && e.n >= this.limit ? { blocked: true, retryAfter: Math.ceil((e.reset - t) / 1000) } : { blocked: false, retryAfter: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private prune(t: number) {
    for (const [k, e] of this.hits) if (e.reset <= t) this.hits.delete(k);
  }
}

/**
 * True when a browser was made to send this change from another site (CSRF). The browser sends the
 * password along by itself, so without this any web page could start searches or send emails.
 * Requests without browser headers (curl, Meta, Gmail's one-click unsubscribe) pass: they can't
 * borrow anyone's saved password.
 */
export function crossSite(method: string, headers: Headers, env: Env = process.env): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const site = headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return true;
  }
  const own = [headers.get("x-forwarded-host"), headers.get("host"), env.APP_BASE_URL && safeHost(env.APP_BASE_URL)]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return !own.includes(host);
}

const safeHost = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return undefined;
  }
};

/**
 * Without a password the app trusts whoever reaches it, so it only answers to localhost and IP
 * addresses (your phone on the same Wi-Fi works). A web page can't then point its own domain name at
 * your computer (DNS rebinding) and read your leads. APP_ALLOWED_HOSTS adds names (comma-separated).
 */
export function hostOkWithoutPassword(hostHeader: string | null, env: Env = process.env): boolean {
  if (!hostHeader) return true;
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || isIP(host)) return true;
  const extra = [...(env.APP_ALLOWED_HOSTS ?? "").split(","), env.APP_BASE_URL ? safeHost(env.APP_BASE_URL)?.replace(/:\d+$/, "") : ""];
  return extra.map((h) => h?.trim().toLowerCase()).some((h) => h && h === host);
}

/** Paths called by outside services, not people: they check their own signature or token (health says only "ok"). */
export const PUBLIC_PATHS = ["/api/whatsapp/webhook", "/api/unsubscribe", "/api/handoff", "/api/health"];
export const isPublicPath = (p: string) => PUBLIC_PATHS.some((x) => p === x || p.startsWith(`${x}/`));

/** Biggest request body accepted (bytes): a bulk email queue carries edited texts, everything else is small. */
export function bodyLimit(path: string): number {
  if (path === "/api/outreach/email/queue") return 4_000_000;
  return 1_000_000;
}

/** Per-address limits on the actions that spend API quota or start a browser. */
export const LIMITS: Array<{ name: string; method: string; match: RegExp; limit: number; windowMs: number }> = [
  { name: "search", method: "POST", match: /^\/api\/search$/, limit: 20, windowMs: 10 * 60_000 },
  { name: "analyze", method: "POST", match: /^\/api\/clients\/analyze$/, limit: 20, windowMs: 10 * 60_000 },
  { name: "report", method: "GET", match: /^\/api\/searches\/[^/]+\/report$/, limit: 40, windowMs: 10 * 60_000 },
  { name: "send", method: "POST", match: /^\/api\/(outreach\/(whatsapp|email\/queue)|agent\/inbox\/[^/]+)$/, limit: 60, windowMs: 10 * 60_000 },
  { name: "unsubscribe", method: "*", match: /^\/api\/unsubscribe$/, limit: 30, windowMs: 60_000 },
  { name: "handoff", method: "*", match: /^\/api\/handoff\//, limit: 60, windowMs: 60_000 },
  { name: "webhook", method: "*", match: /^\/api\/whatsapp\/webhook$/, limit: 600, windowMs: 60_000 },
  { name: "api", method: "*", match: /^\/api\//, limit: 900, windowMs: 60_000 },
];

export interface GateState {
  logins: RateLimiter;
  limits: Map<string, RateLimiter>;
}

export function newGateState(now: () => number = Date.now): GateState {
  return { logins: new RateLimiter(10, 15 * 60_000, now), limits: new Map(LIMITS.map((l) => [l.name, new RateLimiter(l.limit, l.windowMs, now)])) };
}

export type GateResult = { ok: true } | { ok: false; status: number; message: string; headers?: Record<string, string> };

/** Decide what happens to one request. */
export function gate(req: { method: string; url: string; headers: Headers }, state: GateState, env: Env = process.env): GateResult {
  const path = new URL(req.url).pathname;
  const ip = clientIp(req.headers, env);
  const method = req.method.toUpperCase();
  const tooMany = (retryAfter: number): GateResult => ({ ok: false, status: 429, message: "Too many requests. Please wait a little and try again.", headers: { "Retry-After": String(retryAfter) } });

  // size first: nobody gets to make the server read a huge body
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > bodyLimit(path)) return { ok: false, status: 413, message: "Request too large." };

  const pub = isPublicPath(path);
  if (!pub) {
    const problem = passwordProblem(env);
    if (problem) return { ok: false, status: 503, message: problem };
    const password = env.APP_PASSWORD;
    if (!password && !hostOkWithoutPassword(req.headers.get("host"), env)) return { ok: false, status: 403, message: "Unknown host name. Open the app at localhost or its IP address, or add this host to APP_ALLOWED_HOSTS." };
    if (password) {
      const locked = state.logins.blocked(ip);
      if (locked.blocked) return tooMany(locked.retryAfter);
      const given = basicPassword(req.headers.get("authorization"));
      if (given === undefined || !sameSecret(given, password)) {
        if (given !== undefined) state.logins.take(ip); // a wrong password, not just the first visit
        return { ok: false, status: 401, message: "Password required", headers: { "WWW-Authenticate": 'Basic realm="Lead Autopilot", charset="UTF-8"' } };
      }
      state.logins.reset(ip);
    }
    if (path.startsWith("/api/") && crossSite(method, req.headers, env)) return { ok: false, status: 403, message: "Blocked: this change didn't come from the app's own page." };
  }

  for (const l of LIMITS) {
    if ((l.method !== "*" && l.method !== method) || !l.match.test(path)) continue;
    const r = state.limits.get(l.name)!.take(`${l.name}|${ip}`);
    if (!r.ok) return tooMany(r.retryAfter);
    if (l.name !== "api") break; // one specific limit, then the general one below isn't counted twice
  }
  return { ok: true };
}

/** Security headers for every response (see next.config.ts). */
export function securityHeaders(dev = process.env.NODE_ENV === "development"): Array<{ key: string; value: string }> {
  const csp = [
    "default-src 'self'",
    // Next's static pages bootstrap with inline scripts; dev mode also needs eval for React's error overlay
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // lead websites opened from the app never learn the app's address
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
  ];
}
