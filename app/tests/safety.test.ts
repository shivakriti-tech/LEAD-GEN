import { afterEach, describe, expect, it, vi } from "vitest";
import { leadsToCsv } from "@/lib/csv";
import { assertPublicUrl, fetchPublic, isPrivateIp } from "@/lib/safeFetch";
import type { Lead } from "@/lib/types";

describe("private address guard", () => {
  it("spots private, loopback and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "103.21.244.1", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("refuses private hosts and non-web schemes", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/Private/);
    await expect(assertPublicUrl("http://localhost:3000/api/searches")).rejects.toThrow(/Private/);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow(/Private/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("in a live build, won't follow a redirect to a private address", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(u);
      return new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } });
    });
    await expect(fetchPublic("http://93.184.215.14/")).rejects.toThrow(/Private/);
    expect(calls).toEqual(["http://93.184.215.14/"]);
  });
});

describe("CSV export", () => {
  const lead = (name: string, phone?: string): Lead =>
    ({ id: "1", name, category: "Cafe", phone, phones: phone ? [phone] : [], emails: [], sources: ["osm"], signals: [], score: 0, tier: "cold", whyNow: "" }) as Lead;
  const row = (l: Lead) => leadsToCsv([l]).split("\r\n")[1];

  it("neutralises spreadsheet formulas but keeps phone numbers", () => {
    expect(row(lead("=HYPERLINK(\"x\")"))).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row(lead("-2+3+cmd|' /C calc'!A0"))).toContain("'-2+3+cmd");
    expect(row(lead("@SUM(A1)"))).toContain("'@SUM");
    expect(row(lead("Cafe", "+919876543210"))).toContain(",+919876543210,");
  });

  it("quotes carriage returns", () => {
    expect(row(lead("Tea\rPost"))).toContain('"Tea\rPost"');
  });
});
