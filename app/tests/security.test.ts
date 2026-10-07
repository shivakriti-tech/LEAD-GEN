import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { basicPassword, bodyLimit, clientIp, crossSite, gate, hostOkWithoutPassword, newGateState, passwordProblem, RateLimiter, sameSecret, securityHeaders } from "@/lib/security";
import { isPrivateIp } from "@/lib/safeFetch";
import { safeHref } from "@/lib/util";
import { readCapped } from "@/lib/http";
import { localStore, oneAtATime } from "@/lib/store";
import { autoSafe } from "@/lib/agent/inbox";
import type { Lead, SearchRecord } from "@/lib/types";

const basic = (pw: string, user = "me") => `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
const PW = "a-long-test-password";

function req(path: string, opts: { method?: string; headers?: Record<string, string> } = {}) {
  return { method: opts.method ?? "GET", url: `http://app.example${path}`, headers: new Headers({ host: "app.example", ...opts.headers }) };
}
const live = { NODE_ENV: "production", APP_PASSWORD: PW };

describe("password", () => {
  it("lets a live app run only with a long enough password (or APP_OPEN=yes)", () => {
    expect(passwordProblem({ NODE_ENV: "production" })).toMatch(/without a password/);
    expect(passwordProblem({ NODE_ENV: "production", APP_PASSWORD: "short" })).toMatch(/at least 12/);
    expect(passwordProblem({ NODE_ENV: "production", APP_PASSWORD: PW })).toBeUndefined();
    expect(passwordProblem({ NODE_ENV: "production", APP_OPEN: "yes" })).toBeUndefined();
    expect(passwordProblem({ RENDER: "true" })).toMatch(/without a password/);
    expect(passwordProblem({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("refuses a live app with no password, before anything else", () => {
    const r = gate(req("/"), newGateState(), { NODE_ENV: "production" });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("asks for the password, accepts the right one with any user name", () => {
    const s = newGateState();
    expect(gate(req("/"), s, live)).toMatchObject({ ok: false, status: 401, headers: { "WWW-Authenticate": expect.stringContaining("Basic") } });
    expect(gate(req("/", { headers: { authorization: basic("wrong") } }), s, live)).toMatchObject({ ok: false, status: 401 });
    expect(gate(req("/", { headers: { authorization: basic(PW, "anyone") } }), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/searches", { headers: { authorization: basic(PW) } }), s, live)).toEqual({ ok: true });
  });

  it("reads passwords that contain colons", () => {
    expect(basicPassword(basic("a:b:c"))).toBe("a:b:c");
    expect(basicPassword("Bearer x")).toBeUndefined();
    expect(basicPassword(null)).toBeUndefined();
  });

  it("compares secrets of any length without throwing", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "x")).toBe(false);
  });

  it("locks an address out after 10 wrong passwords, even with the right one, for 15 minutes", () => {
    let t = 0;
    const s = newGateState(() => t);
    const from = (ip: string, pw: string) => req("/", { headers: { authorization: basic(pw), "x-forwarded-for": ip } });
    for (let i = 0; i < 10; i++) expect(gate(from("1.2.3.4", `guess${i}`), s, live)).toMatchObject({ status: 401 });
    expect(gate(from("1.2.3.4", PW), s, live)).toMatchObject({ ok: false, status: 429 });
    // someone else is not affected
    expect(gate(from("5.6.7.8", PW), s, live)).toEqual({ ok: true });
    t += 15 * 60_000 + 1;
    expect(gate(from("1.2.3.4", PW), s, live)).toEqual({ ok: true });
  });

  it("doesn't count the browser's first visit (no password yet) as a wrong guess", () => {
    const s = newGateState();
    for (let i = 0; i < 20; i++) gate(req("/", { headers: { "x-forwarded-for": "1.2.3.4" } }), s, live);
    expect(gate(req("/", { headers: { authorization: basic(PW), "x-forwarded-for": "1.2.3.4" } }), s, live)).toEqual({ ok: true });
  });
});

describe("visitor address", () => {
  it("trusts only the entry the host's proxy added", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }), {})).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }), { TRUST_PROXY_HOPS: "2" })).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "9.9.9.9" }), {})).toBe("9.9.9.9");
    expect(clientIp(new Headers(), {})).toBe("unknown");
  });
});

describe("requests from other sites (CSRF)", () => {
  const ok = { authorization: basic(PW) };
  it("refuses changes a browser was made to send from another site", () => {
    const s = newGateState();
    expect(gate(req("/api/search", { method: "POST", headers: { ...ok, "sec-fetch-site": "cross-site" } }), s, live)).toMatchObject({ ok: false, status: 403 });
    expect(gate(req("/api/search", { method: "POST", headers: { ...ok, "sec-fetch-site": "same-site" } }), s, live)).toMatchObject({ ok: false, status: 403 });
    expect(gate(req("/api/clients/x", { method: "DELETE", headers: { ...ok, origin: "https://evil.example" } }), s, live)).toMatchObject({ ok: false, status: 403 });
    expect(gate(req("/api/clients", { method: "POST", headers: { ...ok, origin: "null" } }), s, live)).toMatchObject({ ok: false, status: 403 });
  });

  it("allows the app's own page, reads, and non-browser tools", () => {
    const s = newGateState();
    expect(gate(req("/api/search", { method: "POST", headers: { ...ok, "sec-fetch-site": "same-origin" } }), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/clients", { method: "POST", headers: { ...ok, origin: "http://app.example" } }), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/searches", { headers: { ...ok, "sec-fetch-site": "cross-site" } }), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/clients", { method: "POST", headers: ok }), s, live)).toEqual({ ok: true });
  });

  it("knows the app's public address behind a proxy", () => {
    const h = new Headers({ host: "localhost:3000", origin: "https://leads.example.com" });
    expect(crossSite("POST", h, {})).toBe(true);
    expect(crossSite("POST", h, { APP_BASE_URL: "https://leads.example.com" })).toBe(false);
    expect(crossSite("POST", new Headers({ host: "localhost:3000", "x-forwarded-host": "leads.example.com", origin: "https://leads.example.com" }), {})).toBe(false);
  });

  it("protects a local app without a password too", () => {
    const r = gate(req("/api/outreach/email/queue", { method: "POST", headers: { host: "localhost:3000", "sec-fetch-site": "cross-site" } }), newGateState(), { NODE_ENV: "development" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("open app (no password)", () => {
  it("answers only to localhost and IP addresses, so DNS rebinding can't read your leads", () => {
    expect(hostOkWithoutPassword("localhost:3000", {})).toBe(true);
    expect(hostOkWithoutPassword("127.0.0.1:3000", {})).toBe(true);
    expect(hostOkWithoutPassword("192.168.1.20:3000", {})).toBe(true);
    expect(hostOkWithoutPassword("[::1]:3000", {})).toBe(true);
    expect(hostOkWithoutPassword("attacker.example:3000", {})).toBe(false);
    expect(hostOkWithoutPassword("leads.mycompany.in", { APP_ALLOWED_HOSTS: "leads.mycompany.in" })).toBe(true);
    expect(hostOkWithoutPassword("leads.mycompany.in", { APP_BASE_URL: "https://leads.mycompany.in" })).toBe(true);
    const r = gate(req("/api/searches", { headers: { host: "attacker.example:3000" } }), newGateState(), { NODE_ENV: "development" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
});

describe("public paths", () => {
  it("lets Meta's webhook and the unsubscribe link in without the password", () => {
    const s = newGateState();
    expect(gate(req("/api/whatsapp/webhook", { method: "POST" }), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/unsubscribe?e=a@b.c&t=x", { method: "POST" }), s, live)).toEqual({ ok: true });
    // but nothing that only looks like them
    expect(gate(req("/api/health"), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/handoff/abc?t=x"), s, live)).toEqual({ ok: true });
    expect(gate(req("/api/handoffs"), s, live)).toMatchObject({ status: 401 });
    expect(gate(req("/api/whatsapp/webhookx"), s, live)).toMatchObject({ status: 401 });
    expect(gate(req("/api/unsubscribe-all"), s, live)).toMatchObject({ status: 401 });
  });

  it("rate limits the unsubscribe link per address", () => {
    const s = newGateState();
    const r = () => gate(req("/api/unsubscribe", { method: "POST", headers: { "x-forwarded-for": "1.1.1.1" } }), s, live);
    for (let i = 0; i < 30; i++) expect(r()).toEqual({ ok: true });
    expect(r()).toMatchObject({ ok: false, status: 429, headers: { "Retry-After": expect.any(String) } });
  });
});

describe("limits", () => {
  it("refuses huge requests before reading them", () => {
    const s = newGateState();
    expect(gate(req("/api/clients", { method: "POST", headers: { authorization: basic(PW), "content-length": "5000000" } }), s, live)).toMatchObject({ status: 413 });
    expect(gate(req("/api/whatsapp/webhook", { method: "POST", headers: { "content-length": "2000000" } }), s, live)).toMatchObject({ status: 413 });
    expect(bodyLimit("/api/outreach/email/queue")).toBeGreaterThan(bodyLimit("/api/clients"));
  });

  it("limits searches per address (they spend API quota)", () => {
    const s = newGateState();
    const search = (ip: string) => gate(req("/api/search", { method: "POST", headers: { authorization: basic(PW), "x-forwarded-for": ip, "sec-fetch-site": "same-origin" } }), s, live);
    for (let i = 0; i < 20; i++) expect(search("1.1.1.1")).toEqual({ ok: true });
    expect(search("1.1.1.1")).toMatchObject({ status: 429 });
    expect(search("2.2.2.2")).toEqual({ ok: true });
  });

  it("rate limiter resets after its window", () => {
    let t = 0;
    const r = new RateLimiter(2, 1000, () => t);
    expect(r.take("k").ok).toBe(true);
    expect(r.take("k").ok).toBe(true);
    expect(r.take("k").ok).toBe(false);
    t = 1001;
    expect(r.take("k").ok).toBe(true);
  });
});

describe("security headers", () => {
  it("sets a strict policy: no framing, no sniffing, no referrer, scripts only from the app", () => {
    const h = Object.fromEntries(securityHeaders(false).map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["Content-Security-Policy"]).toMatch(/object-src 'none'/);
    expect(h["Content-Security-Policy"]).not.toMatch(/unsafe-eval/);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age/);
    expect(Object.fromEntries(securityHeaders(true).map((x) => [x.key, x.value]))["Content-Security-Policy"]).toMatch(/unsafe-eval/);
  });
});

describe("private addresses hidden inside IPv6", () => {
  it("spots mapped, NAT64 and 6to4 forms of private IPv4", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a00:1", "64:ff9b::127.0.0.1", "2002:c0a8:101::1", "::ffff:0:10.0.0.1", "2001:db8::1"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["::ffff:808:808", "2002:808:808::1", "64:ff9b::808:808", "203.0.114.1"]) expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe("links from outside data", () => {
  it("only http(s) becomes clickable", () => {
    expect(safeHref("https://shop.example/x")).toBe("https://shop.example/x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe("reading request bodies", () => {
  it("stops reading past the limit", async () => {
    const big = new Request("http://x/", { method: "POST", body: "x".repeat(2000) });
    expect(await readCapped(big, 1000)).toBeUndefined();
    const small = new Request("http://x/", { method: "POST", body: "hello" });
    expect(await readCapped(small, 1000)).toBe("hello");
  });
});

describe("saving searches on disk", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const lead = (id: string): Lead => ({ id, name: id, category: "Cafe", phones: [], emails: [], sources: ["osm"], signals: [], score: 0, tier: "cold", whyNow: "" });
  const search: SearchRecord = { id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-10-01T00:00:00Z", params: { sells: "website_development", categories: ["cafe"], city: "Vadodara", perCategory: 5, sources: { google: false, osm: true, apollo: false, instagram: false, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true }, status: "done", counts: { found: 3, afterDedupe: 3, hot: 0, warm: 0, cold: 3 } };

  it("keeps every change when several arrive at the same moment", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lead-store-"));
    const store = localStore(dir);
    await store.saveSearch(search);
    await store.saveLeads(search.id, ["a", "b", "c"].map(lead));
    const at = new Date().toISOString();
    await Promise.all(["a", "b", "c"].map((id) => store.updateFollowUps(search.id, [{ id, followUp: { status: "contacted", updatedAt: at } }])));
    const got = await store.getSearch(search.id);
    expect(got!.leads.map((l) => l.followUp?.status)).toEqual(["contacted", "contacted", "contacted"]);
    // and leaves no half-written files behind
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("runs queued changes in order and survives a failing one", async () => {
    const order: number[] = [];
    const a = oneAtATime("k", async () => void order.push(1));
    const b = oneAtATime("k", async () => {
      throw new Error("boom");
    });
    const c = oneAtATime("k", async () => void order.push(3));
    await a;
    await expect(b).rejects.toThrow("boom");
    await c;
    expect(order).toEqual([1, 3]);
  });
});

describe("AI inbox auto-send", () => {
  it("sends by itself only a short polite close with no links, addresses or numbers", () => {
    expect(autoSafe("Thanks for letting me know, I'll check back in a few months.")).toBe(true);
    expect(autoSafe("Thanks! Here's 50% off: https://evil.example/pay")).toBe(false);
    expect(autoSafe("Please write to billing@evil.example")).toBe(false);
    expect(autoSafe("Call 9876543210")).toBe(false);
    expect(autoSafe("x".repeat(700))).toBe(false);
  });
});

describe("WhatsApp webhook", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses unsigned or oversized events and checks the verify token", async () => {
    vi.stubEnv("WHATSAPP_TOKEN", "t");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1");
    vi.stubEnv("WHATSAPP_APP_SECRET", "secret");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-me");
    const { GET, POST } = await import("@/app/api/whatsapp/webhook/route");
    const unsigned = await POST(new Request("http://x/api/whatsapp/webhook", { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(401);
    const huge = await POST(new Request("http://x/api/whatsapp/webhook", { method: "POST", body: "x".repeat(1_100_000) }));
    expect(huge.status).toBe(413);
    const body = JSON.stringify({ entry: [] });
    const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
    const signed = await POST(new Request("http://x/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
    expect(signed.status).toBe(200);
    expect((await GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"))).status).toBe(200);
    expect((await GET(new Request("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"))).status).toBe(403);
  });
});
