import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { live, track } from "@/lib/live";
import type { Lead } from "@/lib/types";

const lead = (id: string): Lead => ({ id, name: `Biz ${id}`, category: "Dentist", phones: [], emails: [], sources: ["osm"], signals: [], score: 50, tier: "warm", whyNow: "", pending: true });

describe("changing a status while the search is still running", () => {
  afterEach(() => {
    live.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("puts the change on the running search's own leads, so its next save keeps it", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(path.join(os.tmpdir(), "lead-live-")));
    vi.stubEnv("SUPABASE_URL", "");
    const emit = track(new AbortController(), () => {});
    const id = "66666666-6666-4666-8666-666666666666";
    const leads = [lead("a"), lead("b"), lead("c")];
    emit({ type: "start", searchId: id });
    emit({ type: "leads", leads });

    const one = await import("@/app/api/searches/[id]/leads/[leadId]/route");
    const r1 = await one.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "contacted", followUpOn: "2026-10-01" }) }), { params: Promise.resolve({ id, leadId: "a" }) });
    expect(r1.status).toBe(200);
    expect(leads[0].followUp).toMatchObject({ status: "contacted", followUpOn: "2026-10-01" });
    expect(leads[0].followUp?.contactedAt).toBeTruthy();

    const many = await import("@/app/api/searches/[id]/leads/route");
    const r2 = await many.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ids: ["b", "c"], status: "replied" }) }), { params: Promise.resolve({ id }) });
    expect(r2.status).toBe(200);
    expect(leads.map((l) => l.followUp?.status)).toEqual(["contacted", "replied", "replied"]);

    // deleting still waits until the search is done
    const r3 = await many.DELETE(new Request("http://x", { method: "DELETE", body: JSON.stringify({ ids: ["b"] }) }), { params: Promise.resolve({ id }) });
    expect(r3.status).toBe(409);

    // a business not in the list yet
    const r4 = await one.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "won" }) }), { params: Promise.resolve({ id, leadId: "zzz" }) });
    expect(r4.status).toBe(409);
    emit.end();
  });
});
