import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { auditWebsite, parsePage } from "@/lib/enrich/crawl";

const fx = (n: string) => readFileSync(path.join(__dirname, "fixtures", n), "utf8");

describe("parsePage", () => {
  const p = parsePage(fx("old-site.html"), "http://sharmadental.in/");
  it("finds emails, lowercased, without image names", () => {
    expect(p.emails).toContain("info@sharmadental.in");
    expect(p.emails).toContain("appointments@sharmadental.in");
    expect(p.emails.some((e) => e.includes("png"))).toBe(false);
  });
  it("finds phones in text", () => expect(p.phones).toEqual(expect.arrayContaining(["+919822012345", "+919000011111"])));
  it("finds WhatsApp and Instagram", () => {
    expect(p.whatsapp).toBe("+919000022222");
    expect(p.socials.instagram).toContain("instagram.com/sharmadental");
  });
  it("reads site age and tech", () => {
    expect(p.copyrightYear).toBe(2019);
    expect(p.mobileViewport).toBe(false);
    expect(p.builder).toBe("WordPress");
  });
  it("finds the contact page", () => expect(p.contactLinks).toEqual(["http://sharmadental.in/contact-us"]));
});

describe("auditWebsite (real HTTP against a local server)", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(fx("old-site.html")); }
      else if (req.url === "/contact-us") { res.writeHead(200, { "content-type": "text/html" }); res.end(fx("contact.html")); }
      else if (req.url === "/parked") { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body>This domain is for sale!</body></html>"); }
      else { res.writeHead(500); res.end("boom"); }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(() => server.close());

  it("audits a working site and follows the contact page", async () => {
    const a = await auditWebsite(base + "/");
    expect(a.status).toBe("ok");
    expect(a.https).toBe(false);
    expect(a.mobileViewport).toBe(false);
    expect(a.emails).toContain("reception@sharmadental.in");
    expect(a.phones).toContain("+912025431234");
    expect(a.socials.facebook).toContain("facebook.com/sharmadentalpune");
  });
  it("marks HTTP errors as down", async () => {
    const a = await auditWebsite(base + "/broken");
    expect(a.status).toBe("down");
    expect(a.httpStatus).toBe(500);
  });
  it("marks parked domains as down", async () => expect((await auditWebsite(base + "/parked")).status).toBe("down"));
  it("marks unreachable hosts as down", async () => expect((await auditWebsite("http://127.0.0.1:1/")).status).toBe("down"));
  it("treats Instagram links as social only", async () => {
    const a = await auditWebsite("https://www.instagram.com/somecafe/");
    expect(a.status).toBe("social_only");
    expect(a.socials.instagram).toBeDefined();
  });
  it("no website", async () => expect((await auditWebsite(undefined)).status).toBe("none"));
});
