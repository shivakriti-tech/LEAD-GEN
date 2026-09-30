import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Lead } from "./types";
import { addDays, canContact, linkedinOf, type Sender } from "./outreach";

/**
 * LinkedIn tasks for your team. LinkedIn doesn't allow automated sending (accounts get restricted),
 * so the app prepares the work and people do the clicks: open the profile, send the connection
 * request with the ready note, and mark it done. Each person has a daily limit that keeps their
 * account well inside LinkedIn's weekly invitation cap (about 100).
 */

export interface TeamMember {
  id: string;
  name: string;
  /** Connection requests a day (LinkedIn allows about 100 a week). */
  perDay: number;
}
export type TaskKind = "connect" | "find_person";
export type TaskStatus = "todo" | "done" | "skipped" | "replied";
export interface LinkedInTask {
  id: string;
  createdAt: string;
  searchId: string;
  leadId: string;
  leadName: string;
  /** Profile (connect) or company page (find the owner there first). */
  url: string;
  kind: TaskKind;
  note: string;
  assignee?: string;
  due: string;
  status: TaskStatus;
  doneAt?: string;
}
export interface LinkedInData {
  team: TeamMember[];
  tasks: LinkedInTask[];
}

/** Notes on connection requests are cut at 200 characters on free accounts. */
export const NOTE_MAX = 200;

/** A short, specific connection note in the client's voice. */
export function linkedinNote(l: Pick<Lead, "name" | "category" | "owner" | "pitchFor" | "city">, sender: Sender): string {
  const first = l.owner?.name?.split(/\s+/)[0];
  const hi = first ? `Hi ${first}` : "Hello";
  const from = sender.company ? `${sender.name ?? "I"} from ${sender.company}` : sender.name ?? "I";
  const about =
    l.pitchFor?.kind === "logistics" ? "I work with manufacturers and exporters on shipping and customs"
    : l.pitchFor?.kind === "agency" ? (l.pitchFor.track === "store" ? "I build online stores for product brands" : "I build websites, CRM/ERP and automation for companies like yours")
    : `I help ${l.category.toLowerCase()} businesses with their websites`;
  const where = l.city ? ` in ${l.city}` : "";
  const variants = [
    `${hi}, came across ${l.name}${where}. ${about}. Would be glad to connect. – ${from}`,
    `${hi}, came across ${l.name}. ${about}. Glad to connect. – ${from}`,
    `${hi}, came across ${l.name}. Glad to connect. – ${from}`,
  ];
  return (variants.find((v) => v.length <= NOTE_MAX) ?? variants.at(-1)!).slice(0, NOTE_MAX);
}

/**
 * Make tasks for leads with a LinkedIn page, or say why not. A person's profile → connect with a
 * note; only a company page → find the owner or manager there first.
 */
export function makeTasks(d: LinkedInData, r: { searchId: string; leads: Lead[]; sender: Sender }, today: string, now = new Date()): { added: number; skipped: Array<{ name: string; why: string }> } {
  const out = { added: 0, skipped: [] as Array<{ name: string; why: string }> };
  const fresh: LinkedInTask[] = [];
  for (const l of r.leads) {
    const li = linkedinOf(l);
    if (!li) {
      out.skipped.push({ name: l.name, why: "No LinkedIn page found on their website" });
      continue;
    }
    const can = canContact(l, "linkedin");
    if (!can.ok) {
      out.skipped.push({ name: l.name, why: can.why! });
      continue;
    }
    if (d.tasks.some((t) => t.searchId === r.searchId && t.leadId === l.id && t.status === "todo")) {
      out.skipped.push({ name: l.name, why: "Already has a task" });
      continue;
    }
    fresh.push({ id: randomUUID(), createdAt: now.toISOString(), searchId: r.searchId, leadId: l.id, leadName: l.name, url: li.url, kind: li.kind === "person" ? "connect" : "find_person", note: linkedinNote(l, r.sender), due: today, status: "todo" });
  }
  d.tasks.push(...fresh);
  plan(d, today);
  out.added = fresh.length;
  return out;
}

/**
 * Share open tasks out: each person gets up to their daily limit per day (Monday–Saturday), in turn;
 * what doesn't fit today moves to the next day. Tasks already done keep their day and person.
 */
export function plan(d: LinkedInData, today: string): void {
  const team = d.team.filter((m) => m.perDay > 0);
  const open = d.tasks.filter((t) => t.status === "todo").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!team.length) {
    for (const t of open) Object.assign(t, { assignee: undefined, due: t.due < today ? today : t.due });
    return;
  }
  // how many each person already has on each day (tasks done count for their day)
  const load = new Map<string, number>();
  const k = (m: string, day: string) => `${m}|${day}`;
  for (const t of d.tasks) if (t.status !== "todo" && t.assignee && t.doneAt) load.set(k(t.assignee, t.doneAt.slice(0, 10)), (load.get(k(t.assignee, t.doneAt.slice(0, 10))) ?? 0) + 1);
  let day = today, turn = 0;
  const isSunday = (dd: string) => new Date(`${dd}T12:00:00Z`).getUTCDay() === 0;
  for (const t of open) {
    for (let guard = 0; guard < 400; guard++) {
      if (isSunday(day)) {
        day = addDays(1, new Date(`${day}T12:00:00`));
        continue;
      }
      const m = team.slice(turn).concat(team.slice(0, turn)).find((x) => (load.get(k(x.id, day)) ?? 0) < x.perDay);
      if (m) {
        load.set(k(m.id, day), (load.get(k(m.id, day)) ?? 0) + 1);
        Object.assign(t, { assignee: m.id, due: day });
        turn = (team.indexOf(m) + 1) % team.length;
        break;
      }
      day = addDays(1, new Date(`${day}T12:00:00`));
      turn = 0;
    }
  }
}

const file = () => path.join(process.cwd(), ".data", "outreach", "linkedin.json");
export async function readLinkedIn(): Promise<LinkedInData> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as LinkedInData;
  } catch {
    return { team: [], tasks: [] };
  }
}
let chain: Promise<unknown> = Promise.resolve();
export function updateLinkedIn<T>(fn: (d: LinkedInData) => T): Promise<T> {
  const run = chain.then(async () => {
    const d = await readLinkedIn();
    const out = fn(d);
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), JSON.stringify(d));
    return out;
  });
  chain = run.catch(() => {});
  return run;
}
