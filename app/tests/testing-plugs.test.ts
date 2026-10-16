import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { listTemplates, parseWahaWebhook, sendWhatsApp, waConfig, wahaRequestOk } from "@/lib/whatsapp";
import { igScraperOn, InstagramBlocked, instagramPublicProfile, parseCount, parseInstagramPage } from "@/lib/sources/igPublic";
import { runSearch, type Deps } from "@/lib/pipeline";
import { emptyAudit } from "@/lib/enrich/crawl";
import type { Lead, SearchRecord } from "@/lib/types";
import type { Store } from "@/lib/store";

/** Stand-ins until the official keys arrive: WAHA for WhatsApp (DeskcommCRM's way), public Instagram pages (Scout's way). */

const WAHA = { WAHA_URL: "http://localhost:3030/", WAHA_API_KEY: "k", WAHA_WEBHOOK_SECRET: "s3cret-s3cret" };

describe("WhatsApp through WAHA (testing only)", () => {
  it("is used only on your own computer, and Meta's API wins once its token is set", () => {
    expect(waConfig(WAHA)).toEqual({ provider: "waha", url: "http://localhost:3030", apiKey: "k", session: "default", webhookSecret: "s3cret-s3cret" });
    expect(waConfig({ ...WAHA, NODE_ENV: "production" })).toBeUndefined();
    expect(waConfig({ ...WAHA, RENDER: "true" })).toBeUndefined();
    expect(waConfig({ ...WAHA, WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1" })?.provider).toBe("meta");
  });

  it("runs on a hosted app only with ALLOW_TESTING_TOOLS=yes, reaching WAHA by Render's private host:port", () => {
    const online = { WAHA_URL: "lead-autopilot-waha-ab12:3000", WAHA_API_KEY: "k", RENDER: "true", ALLOW_TESTING_TOOLS: "yes" };
    expect(waConfig(online)).toMatchObject({ provider: "waha", url: "http://lead-autopilot-waha-ab12:3000" });
    expect(waConfig({ ...online, ALLOW_TESTING_TOOLS: "" })).toBeUndefined();
    expect(igScraperOn({ IG_SCRAPER: "on", RENDER: "true", ALLOW_TESTING_TOOLS: "yes" })).toBe(true);
  });

  it("sends free text through /api/sendText, and refuses templates (those are Meta's)", async () => {
    const c = waConfig(WAHA)!;
    let sent: { url: string; body: Record<string, unknown>; key?: string } | undefined;
    const f = (async (url: string, init: RequestInit) => ((sent = { url, body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)["X-Api-Key"] }), new Response(JSON.stringify({ id: "true_919825012345@c.us_3EB0ABC" })))) as never;
    expect(await sendWhatsApp(c, "+91 98250 12345", { kind: "text", text: "Thanks, sharing the rates now" }, f)).toEqual({ id: "true_919825012345@c.us_3EB0ABC" });
    expect(sent).toEqual({ url: "http://localhost:3030/api/sendText", key: "k", body: { session: "default", chatId: "919825012345@c.us", text: "Thanks, sharing the rates now" } });
    await expect(sendWhatsApp(c, "+919825012345", { kind: "template", name: "x", language: "en", params: [] }, f)).rejects.toThrow(/templates/);
    expect(await listTemplates(c, f)).toEqual([]);
    const notLinked = (async () => new Response(JSON.stringify({ message: "Session status is not as expected: SCAN_QR_CODE" }), { status: 422 })) as never;
    await expect(sendWhatsApp(c, "+919825012345", { kind: "text", text: "hi" }, notLinked)).rejects.toThrow(/scan the QR code/);
  });

  it("reads people writing in and delivery updates; skips your own messages, groups and status posts", () => {
    const at = 1791000000;
    expect(parseWahaWebhook({ event: "message", session: "default", payload: { id: "false_919825012345@c.us_A1", from: "919825012345@c.us", fromMe: false, body: "Yes, send the rates", timestamp: at } })).toEqual([
      { kind: "message", number: "919825012345", id: "false_919825012345@c.us_A1", at: new Date(at * 1000).toISOString(), text: "Yes, send the rates" },
    ]);
    // newer WhatsApp: the chat is an @lid id and the number comes in remoteJidAlt
    expect(parseWahaWebhook({ event: "message", payload: { id: "m2", from: "123456789@lid", fromMe: false, body: "STOP", timestamp: at, _data: { key: { remoteJidAlt: "919811122233@s.whatsapp.net" } } } })[0]).toMatchObject({ number: "919811122233", text: "STOP" });
    expect(parseWahaWebhook({ event: "message", payload: { id: "m3", from: "123456789@lid", fromMe: false, body: "hi", timestamp: at } })).toEqual([]);
    expect(parseWahaWebhook({ event: "message", payload: { id: "m4", from: "120363000000@g.us", fromMe: false, body: "group chat", timestamp: at } })).toEqual([]);
    expect(parseWahaWebhook({ event: "message", payload: { id: "m5", from: "status@broadcast", fromMe: false, body: "story", timestamp: at } })).toEqual([]);
    expect(parseWahaWebhook({ event: "message", payload: { id: "m6", from: "919825012345@c.us", to: "919825012345@c.us", fromMe: true, body: "mine", timestamp: at } })).toEqual([]);
    expect(parseWahaWebhook({ event: "message.ack", payload: { id: "true_919825012345@c.us_3EB0ABC", from: "910000000000@c.us", to: "919825012345@c.us", fromMe: true, ack: 3, ackName: "READ", timestamp: at } })).toEqual([
      { kind: "status", number: "919825012345", id: "true_919825012345@c.us_3EB0ABC", at: new Date(at * 1000).toISOString(), status: "read" },
    ]);
    expect(parseWahaWebhook(null)).toEqual([]);
  });

  it("accepts WAHA's events only with the secret: in the hook URL, or as a correct signature", () => {
    const raw = JSON.stringify({ event: "message" });
    const url = "http://host.docker.internal:3000/api/whatsapp/webhook/waha";
    const sig = createHmac("sha512", "s3cret-s3cret").update(raw).digest("hex");
    expect(wahaRequestOk(raw, `${url}?token=s3cret-s3cret`, null, "s3cret-s3cret")).toBe(true);
    expect(wahaRequestOk(raw, `${url}?token=guess`, null, "s3cret-s3cret")).toBe(false);
    expect(wahaRequestOk(raw, url, null, "s3cret-s3cret")).toBe(false);
    expect(wahaRequestOk(raw, url, sig, "s3cret-s3cret")).toBe(true);
    // a wrong signature is refused even with the right token
    expect(wahaRequestOk(raw, `${url}?token=s3cret-s3cret`, "00".repeat(64), "s3cret-s3cret")).toBe(false);
  });
});

const PAGE = `<html><head><title>Royal Furniture (@royalfurniture.vdr) • Instagram</title>
<meta content="2,350 Followers, 120 Following, 410 Posts - Royal Furniture (@royalfurniture.vdr)" name="description"></head>
<script>{"username":"royalfurniture.vdr","full_name":"Royal Furniture \\u0026 Decor","biography":"Custom sofas \\ud83d\\udecb\\ufe0f\\nCall 98250 12345","external_url":"https:\\/\\/royalfurniture.in\\/","follower_count":2350,"media_count":410,"is_private":false,"taken_at_timestamp":1789900000},{"taken_at_timestamp":1790500000}</script></html>`;

describe("Instagram from public pages (testing only, Scout's way)", () => {
  it("is used only when turned on, and never in a live build", () => {
    expect(igScraperOn({})).toBe(false);
    expect(igScraperOn({ IG_SCRAPER: "on" })).toBe(true);
    expect(igScraperOn({ IG_SCRAPER: "on", NODE_ENV: "production" })).toBe(false);
  });

  it("reads name, bio, website, followers, posts and the newest post from the page", () => {
    expect(parseInstagramPage(PAGE, "royalfurniture.vdr")).toEqual({
      handle: "royalfurniture.vdr", name: "Royal Furniture & Decor", bio: "Custom sofas 🛋️\nCall 98250 12345", website: "https://royalfurniture.in/",
      followers: 2350, posts: 410, lastPostAt: new Date(1790500000 * 1000).toISOString(),
    });
    // only the page description
    expect(parseInstagramPage(`<meta content="1.2K Followers, 10 Following, 56 Posts - Chai Point" name="description">`, "chaipoint")).toMatchObject({ followers: 1200, posts: 56 });
    expect(parseInstagramPage(`{"is_private":true,"follower_count":90}`, "x")).toBeNull();
    expect(parseInstagramPage(`<title>Page Not Found • Instagram</title>`, "x")).toBeNull();
    expect(parseCount("3,456")).toBe(3456);
    expect(parseCount("2.5M")).toBe(2_500_000);
  });

  it("stops when Instagram asks for a login or rate limits", async () => {
    const login = (async () => new Response(null, { status: 302, headers: { location: "https://www.instagram.com/accounts/login/?next=%2Fx%2F" } })) as never;
    await expect(instagramPublicProfile("x", login)).rejects.toBeInstanceOf(InstagramBlocked);
    const limited = (async () => new Response("", { status: 429 })) as never;
    await expect(instagramPublicProfile("x", limited)).rejects.toBeInstanceOf(InstagramBlocked);
    const missing = (async () => new Response("", { status: 404 })) as never;
    expect(await instagramPublicProfile("x", missing)).toBeNull();
    const ok = (async () => new Response(PAGE, { status: 200 })) as never;
    expect((await instagramPublicProfile("royalfurniture.vdr", ok))?.followers).toBe(2350);
  });

  it("fills Instagram details in a search when there's no official token, and the API takes over once there is", async () => {
    const memStore = (): Store => {
      const data = new Map<string, { search: SearchRecord; leads: Lead[] }>();
      return {
        kind: "local",
        async saveSearch(s) { data.set(s.id, { search: structuredClone(s), leads: data.get(s.id)?.leads ?? [] }); },
        async saveLeads(id, leads) { data.get(id)!.leads = leads; },
        async listSearches() { return [...data.values()].map((x) => x.search); },
        async getSearch(id) { return data.get(id) ?? null; },
        async updateFollowUps() { return []; },
        async deleteLeads() { return 0; },
      };
    };
    const scraped: string[] = [], api: string[] = [];
    const deps = (keys: Deps["keys"]): Deps => ({
      keys, store: memStore(), now: () => new Date("2026-09-22"),
      webSearch: async () => [],
      google: async () => ({ places: [], requests: 0 }),
      geocode: async () => ({ box: { south: 0, west: 0, north: 1, east: 1 }, via: "t" }),
      osm: async () => [],
      web: async () => ({ places: [], queries: 0, rejected: [] }),
      gmaps: async () => [],
      social: async ({ platform, category, city }) => platform === "instagram" ? [{ source: "instagram", sourceId: "royalfurniture.vdr", name: "royal furniture vdr", category, city, website: "https://www.instagram.com/royalfurniture.vdr/" }] : [],
      igLookup: async ({ handle }) => (api.push(handle), null),
      igPublic: async (handle) => (scraped.push(handle), { handle, name: "Royal Furniture", followers: 2350, lastPostAt: "2026-09-18T10:00:00Z" }),
      fbSearch: async () => [],
      checkCandidate: async () => ({ ok: false, evidence: "" }),
      discover: async () => ({ tried: [] }),
      audit: async (w) => (w ? emptyAudit("social_only", { socials: { instagram: w } }) : emptyAudit("none")),
      pageSpeed: async () => { throw new Error("off"); },
      apollo: async () => null,
    });
    const params = { sells: "website_development" as const, categories: ["furniture"], city: "Vadodara", perCategory: 10, sources: { google: false, osm: false, apollo: false, instagram: true, facebook: false, web: false, gmaps: false }, pageSpeed: false, verifyWebsites: true, webSearch: true };
    const { leads } = await runSearch(params, deps({ igScraper: true }), () => {});
    expect(scraped).toEqual(["royalfurniture.vdr"]);
    const ig = leads[0].social!.instagram!;
    expect(ig).toMatchObject({ checked: "scraper", followers: 2350 });
    expect(leads[0].name).toBe("Royal Furniture");
    expect(leads[0].signals.map((s) => s.key)).toContain("ig_active");
    await runSearch(params, deps({ igScraper: true, metaToken: "t", igUserId: "1784" }), () => {});
    expect(api).toEqual(["royalfurniture.vdr"]);
    expect(scraped).toEqual(["royalfurniture.vdr"]);
  });
});
