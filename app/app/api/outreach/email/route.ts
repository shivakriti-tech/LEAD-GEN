import { mailboxesFromEnv, dailyCap, inSendWindow, istParts } from "@/lib/mail/mailboxes";
import { checkDomain, type DomainHealth } from "@/lib/mail/dnsHealth";
import { localQueueStore } from "@/lib/mail/queue";
import { startEmailWorker, workerStatus } from "@/lib/mail/send";
import { getClientStore } from "@/lib/store";
import { domainOf } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __domainHealth?: Map<string, { at: number; h: DomainHealth }> };
const healthCache = (g.__domainHealth ??= new Map());

/** Mailboxes (never their passwords), domain health, today's sending and the queue. */
export async function GET(req: Request) {
  startEmailWorker();
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const { mailboxes, problems } = mailboxesFromEnv();
  const data = await localQueueStore().read();
  const today = istParts(new Date()).date;
  const mainDomains = (await getClientStore().listClients().catch(() => [])).map((c) => domainOf(c.website)).filter(Boolean) as string[];
  const domains = [...new Set(mailboxes.map((m) => m.domain))];
  const health = await Promise.all(
    domains.map(async (d) => {
      const hit = healthCache.get(d);
      if (hit && !fresh && Date.now() - hit.at < 10 * 60_000) return hit.h;
      const h = await checkDomain(d, { mainDomains });
      healthCache.set(d, { at: Date.now(), h });
      return h;
    }),
  );
  const items = [...data.items].sort((a, b) => (b.sentAt ?? b.notBefore).localeCompare(a.sentAt ?? a.notBefore));
  return Response.json({
    window: { open: inSendWindow(new Date()), hours: "Mon–Sat, 10:00–18:30 IST" },
    worker: workerStatus(),
    mailboxes: mailboxes.map((m) => {
      const st = data.mailboxes[m.email];
      const started = m.start ?? st?.startedOn ?? today;
      return { email: m.email, name: m.name, domain: m.domain, startedOn: started, capToday: dailyCap(m, started, today), sentToday: st?.sent[today] ?? 0, lastAt: st?.lastAt, error: st?.error, replyCheck: !!m.imap };
    }),
    problems,
    health,
    counts: { queued: data.items.filter((i) => i.status === "queued").length, sentToday: data.items.filter((i) => i.status === "sent" && i.sentAt && istParts(new Date(i.sentAt)).date === today).length },
    items: items.slice(0, 300).map(({ body, sender, ...i }) => ({ ...i, from: sender.name, hasCustomText: !!body })),
  });
}
