import { describe, expect, it } from "vitest";
import { linkedinNote, makeTasks, NOTE_MAX, plan, type LinkedInData } from "@/lib/linkedin";
import { emptyAudit } from "@/lib/enrich/crawl";
import type { Lead } from "@/lib/types";

const lead = (id: string, linkedin?: string, over: Partial<Lead> = {}): Lead => ({ id, name: `Steel Works ${id}`, category: "Manufacturer", city: "Vadodara", phones: [], emails: [], sources: [], signals: [], score: 70, tier: "hot", whyNow: "", audit: { ...emptyAudit("ok"), socials: linkedin ? { linkedin } : {} }, pitchFor: { kind: "logistics", needs: ["sea"] }, ...over }) as Lead;

describe("LinkedIn tasks for the team", () => {
  it("writes a short note that fits LinkedIn's 200 characters", () => {
    const n = linkedinNote(lead("a", undefined, { owner: { name: "Rakesh Patel", via: "website" } }), { name: "Divy", company: "Shree Logistics" });
    expect(n).toBe("Hi Rakesh, came across Steel Works a in Vadodara. I work with manufacturers and exporters on shipping and customs. Would be glad to connect. – Divy from Shree Logistics");
    const long = linkedinNote(lead("a", undefined, { name: "A Very Long Business Name Private Limited Industrial Engineering Works And Fabrication Unit" }), { name: "Divy", company: "Shree Logistics International Freight Forwarders" });
    expect(long.length).toBeLessThanOrEqual(NOTE_MAX);
  });

  it("connects with people, finds the owner on company pages, and skips leads without LinkedIn", () => {
    const d: LinkedInData = { team: [], tasks: [] };
    const r = makeTasks(d, { searchId: "s", leads: [lead("a", "https://www.linkedin.com/in/rakesh-patel"), lead("b", "https://linkedin.com/company/steel-b"), lead("c")], sender: { name: "Divy" } }, "2026-10-05");
    expect(r).toEqual({ added: 2, skipped: [{ name: "Steel Works c", why: "No LinkedIn page found on their website" }] });
    expect(d.tasks.map((t) => [t.kind, t.url])).toEqual([["connect", "https://www.linkedin.com/in/rakesh-patel"], ["find_person", "https://www.linkedin.com/company/steel-b"]]);
    expect(makeTasks(d, { searchId: "s", leads: [lead("a", "https://www.linkedin.com/in/rakesh-patel")], sender: {} }, "2026-10-05").skipped[0].why).toBe("Already has a task");
  });

  it("shares tasks out by daily limits, skipping Sundays", () => {
    const d: LinkedInData = { team: [{ id: "asha", name: "Asha", perDay: 2 }, { id: "ravi", name: "Ravi", perDay: 1 }], tasks: [] };
    makeTasks(d, { searchId: "s", leads: Array.from({ length: 5 }, (_, i) => lead(`l${i}`, `https://www.linkedin.com/in/p${i}`)), sender: {} }, "2026-10-03"); // a Saturday
    expect(d.tasks.map((t) => `${t.assignee}@${t.due}`)).toEqual(["asha@2026-10-03", "ravi@2026-10-03", "asha@2026-10-03", "asha@2026-10-05", "ravi@2026-10-05"]);
    // Asha finishes one today: her done task still counts for today, nothing moves into today
    Object.assign(d.tasks[0], { status: "done", doneAt: "2026-10-03T11:00:00.000Z" });
    plan(d, "2026-10-03");
    expect(d.tasks.filter((t) => t.status === "todo" && t.due === "2026-10-03")).toHaveLength(2);
  });
});
