import { tokenOk } from "@/lib/mail/unsubscribe";
import { applyInbox, queueStore, mutate } from "@/lib/mail/queue";
import { savedLeads } from "@/lib/mail/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const page = (title: string, body: string) =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#222;line-height:1.5">${body}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

async function unsubscribe(email: string) {
  const queue = queueStore();
  const d = await queue.read();
  const mailbox = d.items.find((i) => i.to.toLowerCase() === email && i.mailbox)?.mailbox ?? "";
  const leads = await mutate(queue, (x) => applyInbox(x, mailbox, [{ kind: "unsubscribe", address: email }]));
  for (const l of leads) await savedLeads.patch(l.searchId, l.leadId, { optOut: { via: "Email: unsubscribe link" } });
}

/** The link opened in a browser: a button to confirm (mail scanners open links, so GET changes nothing). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const e = (q.get("e") ?? "").toLowerCase(), t = q.get("t") ?? "";
  if (!e || !(await tokenOk(e, t))) return page("Link not valid", "<p>This unsubscribe link isn't valid. Reply to the email with \"unsubscribe\" instead.</p>");
  return page("Unsubscribe", `<p>Stop emails to <b>${e.replace(/[<>&"]/g, "")}</b>?</p><form method="post"><button style="font:inherit;padding:8px 16px;cursor:pointer">Unsubscribe</button></form>`);
}

/** One-click from Gmail/Yahoo (RFC 8058), or the button above. */
export async function POST(req: Request) {
  const q = new URL(req.url).searchParams;
  const e = (q.get("e") ?? "").toLowerCase(), t = q.get("t") ?? "";
  if (!e || !(await tokenOk(e, t))) return new Response("Invalid link", { status: 400 });
  await unsubscribe(e);
  return page("Unsubscribed", "<p>Done: you won't get any more emails from us. Sorry for the bother.</p>");
}
