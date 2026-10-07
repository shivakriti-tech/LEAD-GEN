"use client";

import { useCallback, useEffect, useState } from "react";
import { localDate, STEP_LABEL } from "@/lib/outreach";
import { safeHref } from "@/lib/util";
import { IconCheck, IconClose, IconCopy, IconLink, IconMail, IconPlus, IconUser, IconWhatsApp } from "./icons";

/**
 * Outreach: the email queue with your mailboxes and domain health, the WhatsApp Business API, and
 * the LinkedIn tasks for your team. Leads get here from the results: tick them → Email / LinkedIn.
 */

type Tab = "inbox" | "email" | "whatsapp" | "linkedin";
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

export function OutreachView() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [waiting, setWaiting] = useState(0);
  useEffect(() => void fetch("/api/agent/inbox").then((r) => r.json()).then((d) => setWaiting(d.waiting ?? 0)).catch(() => {}), [tab]);
  return (
    <section className="outreach">
      <div className="top">
        <div>
          <h1>Outreach</h1>
          <p>Emails go out from your own mailboxes a few at a time in office hours, with follow-ups that stop when someone replies. WhatsApp's API is for people who replied or opted in. LinkedIn is a daily task list for your team.</p>
        </div>
      </div>
      <div className="seg big-seg" role="tablist" aria-label="Channel">
        <button role="tab" aria-selected={tab === "inbox"} aria-pressed={tab === "inbox"} onClick={() => setTab("inbox")}><IconCheck /> Inbox{waiting ? <span className="count">{waiting}</span> : null}</button>
        <button role="tab" aria-selected={tab === "email"} aria-pressed={tab === "email"} onClick={() => setTab("email")}><IconMail /> Email</button>
        <button role="tab" aria-selected={tab === "whatsapp"} aria-pressed={tab === "whatsapp"} onClick={() => setTab("whatsapp")}><IconWhatsApp /> WhatsApp</button>
        <button role="tab" aria-selected={tab === "linkedin"} aria-pressed={tab === "linkedin"} onClick={() => setTab("linkedin")}><IconUser /> LinkedIn</button>
      </div>
      {tab === "inbox" ? <InboxTab onChange={setWaiting} /> : tab === "email" ? <EmailTab /> : tab === "whatsapp" ? <WhatsAppTab /> : <LinkedInTab />}
    </section>
  );
}

/* ---------- Inbox: replies, what they mean, and the drafted answers ---------- */

type Conv = {
  id: string; channel: "email" | "whatsapp"; address: string; leadName?: string; subject?: string; status: "drafted" | "handoff" | "sent" | "closed"; updatedAt: string; draft?: string;
  messages: Array<{ dir: "in" | "out"; text: string; at: string; by?: string }>;
  agent?: { intent: string; summary: string; handoff: boolean; why?: string; by: string; returnOn?: string; referral?: string };
};
const INTENT: Record<string, { label: string; kind: string }> = {
  interested: { label: "Interested", kind: "good" }, meeting: { label: "Wants a call", kind: "good" }, question: { label: "Has a question", kind: "warn" },
  not_now: { label: "Not now", kind: "" }, not_interested: { label: "Not interested", kind: "bad" }, unsubscribe: { label: "Unsubscribed", kind: "bad" },
  out_of_office: { label: "Out of office", kind: "" }, wrong_person: { label: "Wrong person", kind: "" }, referral: { label: "Referred someone", kind: "good" }, other: { label: "Reply", kind: "" },
};

function InboxTab({ onChange }: { onChange: (n: number) => void }) {
  const [d, setD] = useState<{ conversations: Conv[]; waiting: number; ai: boolean; autoSend: boolean } | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => fetch("/api/agent/inbox").then((r) => r.json()).then((x) => { setD(x); onChange(x.waiting ?? 0); }), [onChange]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  const act = async (c: Conv, action: "send" | "close" | "redraft") => {
    setBusy(c.id + action);
    const r = await fetch(`/api/agent/inbox/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, text: texts[c.id] ?? c.draft ?? "" }) });
    const j = await r.json().catch(() => ({}));
    setMsg((m) => ({ ...m, [c.id]: r.ok ? (action === "send" ? "Sent." : action === "redraft" ? "New draft ready." : "") : j.error ?? "Failed" }));
    if (action === "redraft") setTexts((t) => { const n = { ...t }; delete n[c.id]; return n; });
    setBusy("");
    load();
  };
  if (!d) return <p className="sub">Loading…</p>;
  const open = d.conversations.filter((c) => c.status === "handoff" || c.status === "drafted");
  const rest = d.conversations.filter((c) => c.status === "sent" || c.status === "closed");
  return (
    <div className="otab">
      <p className="sub">
        Replies to your emails (and WhatsApp messages) land here. The agent reads each one, says what it means and drafts an answer from the client's Business Brain: no prices or promises it doesn't have.
        {d.ai ? " AI: Gemini (only for real conversations; out-of-office, unsubscribes and plain no's need no AI)." : " AI is off: drafts come from ready replies. Add GEMINI_API_KEY (free) for written answers."}
        {d.autoSend ? " Polite closes (not now, not interested, wrong person) are sent by the agent itself." : " Nothing is sent until you press Send."}
      </p>
      {!open.length && <div className="panel bsec"><p className="sub">Nothing waiting. Replies are checked every 30 minutes.</p></div>}
      {open.map((c) => {
        const last = [...c.messages].reverse().find((m) => m.dir === "in");
        const it = INTENT[c.agent?.intent ?? "other"] ?? INTENT.other;
        return (
          <article className="panel bsec conv" key={c.id}>
            <div className="row between">
              <div><b>{c.leadName ?? c.address}</b> <span className="sub">{c.channel === "email" ? c.address : `WhatsApp +${c.address}`} · {when(c.updatedAt)}</span></div>
              <div className="row gap"><span className={`tag ${it.kind}`}>{it.label}</span>{c.status === "handoff" && <span className="tag warn">Your turn</span>}</div>
            </div>
            {c.subject && <p className="sub">Re: {c.subject}</p>}
            <blockquote className="their">{last?.text}</blockquote>
            {c.agent?.why && <p className="sub"><b>Why it's with you:</b> {c.agent.why}</p>}
            <label className="field">
              <span className="lbl">Your answer <span className="opt">{(c.agent?.by === "gemini" || c.agent?.by === "gpt") ? "drafted by AI, check it" : "ready reply, edit as needed"}</span></span>
              <textarea rows={5} value={texts[c.id] ?? c.draft ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [c.id]: e.target.value }))} placeholder="Write your reply" />
            </label>
            <div className="row gap">
              <button className="btn primary sm" disabled={!!busy} onClick={() => act(c, "send")}>{busy === c.id + "send" ? "Sending…" : c.channel === "email" ? "Send reply" : "Send on WhatsApp"}</button>
              <button className="btn sm" disabled={!!busy} onClick={() => act(c, "redraft")}>{busy === c.id + "redraft" ? "Drafting…" : "New draft"}</button>
              <button className="btn sm" disabled={!!busy} onClick={() => act(c, "close")}>Done, no reply</button>
              {msg[c.id] && <span className="sub">{msg[c.id]}</span>}
            </div>
          </article>
        );
      })}
      {rest.length > 0 && (
        <section className="panel bsec">
          <h2>Handled <span className="count">{rest.length}</span></h2>
          <div className="qlist">
            {(showAll ? rest : rest.slice(0, 10)).map((c) => {
              const it = INTENT[c.agent?.intent ?? "other"] ?? INTENT.other;
              return <div className="qrow" key={c.id}><div><b>{c.leadName ?? c.address}</b><span className="sub">{c.agent?.summary}{c.agent?.referral ? ` · ${c.agent.referral}` : ""}</span></div><span className={`tag ${it.kind}`}>{it.label}</span><span className="sub">{c.status === "sent" ? `Answered ${when(c.updatedAt)}` : when(c.updatedAt)}</span></div>;
            })}
          </div>
          {rest.length > 10 && !showAll && <button className="linkish" onClick={() => setShowAll(true)}>Show all</button>}
        </section>
      )}
    </div>
  );
}

/* ---------- Email ---------- */

type Check = { ok: boolean; label: string; detail: string; fix?: string };
type EmailData = {
  window: { open: boolean; hours: string };
  mailboxes: Array<{ email: string; name?: string; domain: string; startedOn: string; capToday: number; sentToday: number; lastAt?: string; error?: string; paused?: { until: string; why?: string }; sent7: number; bounced7: number; complaints7: number; replyCheck: boolean }>;
  suppressed?: number;
  problems: Array<{ key: string; error: string }>;
  health: Array<{ domain: string; ok: boolean; mainDomain?: boolean; checks: Record<"mx" | "spf" | "dkim" | "dmarc", Check> }>;
  counts: { queued: number; sentToday: number };
  items: Array<{ id: string; leadName: string; to: string; step: number; status: string; reason?: string; notBefore: string; sentAt?: string; mailbox?: string; sentSubject?: string }>;
};

function EmailTab() {
  const [d, setD] = useState<EmailData | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback((fresh = false) => fetch(`/api/outreach/email${fresh ? "?fresh=1" : ""}`).then((r) => r.json()).then(setD).catch(() => setMsg("Couldn't load the email queue")), []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, [load]);
  if (!d) return <p className="sub">{msg || "Loading…"}</p>;
  const verify = async (email: string) => {
    setMsg(`Signing in to ${email}…`);
    const r = await fetch("/api/outreach/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then((x) => x.json());
    setMsg(r.ok ? `${email}: signed in fine.` : `${email}: ${r.error}`);
    load();
  };
  const cancel = async (id: string) => {
    await fetch("/api/outreach/email/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    load();
  };
  const queued = d.items.filter((i) => i.status === "queued").sort((a, b) => a.notBefore.localeCompare(b.notBefore));
  const recent = d.items.filter((i) => i.status !== "queued").slice(0, 40);

  if (!d.mailboxes.length)
    return (
      <div className="panel setup-card">
        <h2>Add a sending mailbox</h2>
        <p>Use an address on a <b>separate sending domain</b> (like getshreelogistics.in), not the client's main one: if cold email ever hurts a domain's reputation, it shouldn't be the one their customers write to. Gmail/Google Workspace, Zoho and Microsoft 365 all work. Use an <b>app password</b>, not the normal one.</p>
        <p>Add a line like this to <code>.env.local</code> and restart the app:</p>
        <pre className="code">MAILBOX_1=smtps://divy%40getshree.in:your-app-password@smtp.zoho.in:465?name=Divy%20Shah</pre>
        <p className="sub">Write @ in the address as %40 and spaces as %20. Gmail: smtps://…@smtp.gmail.com:465. Microsoft 365: smtp://…@smtp.office365.com:587. More mailboxes: MAILBOX_2, MAILBOX_3…</p>
        {d.problems.map((p) => <p className="note" key={p.key}>{p.key} {p.error}</p>)}
      </div>
    );

  return (
    <div className="otab">
      <div className="row gap">
        <span className={`tag ${d.window.open ? "good" : "warn"}`}>{d.window.open ? "Sending now" : "Paused till office hours"}</span>
        <span className="sub">{d.window.hours} · {d.counts.sentToday} sent today · {d.counts.queued} waiting</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => load(true)}>Check again</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      {d.problems.map((p) => <p className="note" key={p.key}>{p.key} {p.error}</p>)}
      <p className="sub">Built-in protection: only checked addresses, plain text with one link at most, a spam-word check, at most 2 emails a day to one company, office hours where they are. Bounces, spam complaints and "unsubscribe" replies are read from the inbox: those addresses are never emailed again{d.suppressed ? ` (${d.suppressed} so far)` : ""}, and a mailbox pauses itself if bounces pass 3%.</p>

      <div className="mb-grid">
        {d.mailboxes.map((m) => {
          const day = Math.max(0, Math.round((Date.parse(`${localDate()}T00:00:00Z`) - Date.parse(`${m.startedOn}T00:00:00Z`)) / 86_400_000)) + 1;
          return (
            <article className="panel mb-card" key={m.email}>
              <div className="row between"><b>{m.email}</b>{m.error || m.paused ? <span className="tag bad">Paused</span> : <span className="tag good">Active</span>}</div>
              <div className="mb-meter" aria-label={`${m.sentToday} of ${m.capToday} sent today`}><i style={{ width: `${Math.min(100, (m.sentToday / Math.max(1, m.capToday)) * 100)}%` }} /></div>
              <p className="sub">Warm-up day {day}: {m.sentToday} of {m.capToday} today{m.lastAt ? ` · last ${when(m.lastAt)}` : ""}</p>
              <p className="sub">{m.replyCheck ? "Checks its inbox for replies before each follow-up" : "Reply check off: mark replies yourself"}</p>
              <p className="sub">This week: {m.sent7} sent · {m.bounced7} bounced{m.sent7 ? ` (${Math.round((m.bounced7 / m.sent7) * 100)}%, keep under 3%)` : ""}{m.complaints7 ? ` · ${m.complaints7} spam complaint${m.complaints7 === 1 ? "" : "s"}` : ""}</p>
              {m.error && <p className="pitch-warn">{m.error}</p>}
              {m.paused && <p className="pitch-warn">{m.paused.why} Resumes {when(m.paused.until)}.</p>}
              <button className="btn sm" onClick={() => verify(m.email)}>Check sign-in</button>
            </article>
          );
        })}
      </div>

      {d.health.map((h) => (
        <section className="panel bsec" key={h.domain}>
          <h2>{h.domain} {h.ok ? <span className="tag good">Ready</span> : <span className="tag warn">Fix before sending much</span>}</h2>
          {h.mainDomain && <p className="note">This is a client's main website domain. Send cold email from a separate domain so their everyday email stays safe.</p>}
          <ul className="health">
            {(["mx", "spf", "dkim", "dmarc"] as const).map((k) => (
              <li key={k} className={h.checks[k].ok ? "ok" : "bad"}>
                <span className="hi">{h.checks[k].ok ? <IconCheck /> : <IconClose />}</span>
                <b>{h.checks[k].label}</b>
                <span className="sub">{h.checks[k].detail}</span>
                {h.checks[k].fix && <span className="fix">{h.checks[k].fix}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="panel bsec">
        <h2>Waiting to send <span className="count">{queued.length}</span></h2>
        {!queued.length ? (
          <p className="sub">Nothing waiting. In a search, tick leads and press <b>Email</b>.</p>
        ) : (
          <div className="qlist">
            {queued.slice(0, 100).map((i) => (
              <div className="qrow" key={i.id}>
                <div><b>{i.leadName}</b><span className="sub">{STEP_LABEL[i.step] ?? `Step ${i.step + 1}`} · {i.to}</span></div>
                <span className="sub">{Date.parse(i.notBefore) > Date.now() ? `not before ${when(i.notBefore)}` : "next in line"}</span>
                <button className="icon-btn" onClick={() => cancel(i.id)} aria-label={`Cancel email to ${i.leadName}`} title="Cancel"><IconClose /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel bsec">
        <h2>Recent</h2>
        {!recent.length ? <p className="sub">Nothing sent yet.</p> : (
          <div className="qlist">
            {recent.map((i) => (
              <div className="qrow" key={i.id}>
                <div><b>{i.leadName}</b><span className="sub">{STEP_LABEL[i.step] ?? `Step ${i.step + 1}`} · {i.status === "sent" ? `${i.sentSubject} · from ${i.mailbox}` : i.reason}</span></div>
                <span className={`tag ${i.status === "sent" ? "good" : i.status === "failed" ? "bad" : ""}`}>{i.status}</span>
                <span className="sub">{when(i.sentAt ?? i.notBefore)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- WhatsApp ---------- */

type WaData = { configured: boolean; webhook?: { verifyToken: boolean; appSecret: boolean }; templates?: Array<{ name: string; language: string; category: string; body?: string; params: number }>; templateError?: string; entries?: Array<{ id: string; at: string; dir: "in" | "out"; number: string; leadName?: string; text?: string; template?: string; status?: string }> };

function WhatsAppTab() {
  const [d, setD] = useState<WaData | null>(null);
  useEffect(() => void fetch("/api/outreach/whatsapp").then((r) => r.json()).then(setD).catch(() => setD({ configured: false })), []);
  if (!d) return <p className="sub">Loading…</p>;
  const rules = (
    <p className="sub">WhatsApp only allows business messages to people who agreed to them. A first hello to a new lead goes from your own phone (the WhatsApp button on each lead). The API is used for leads who replied or opted in, so the client's number doesn't get banned.</p>
  );
  if (!d.configured)
    return (
      <div className="panel setup-card">
        <h2>Connect the WhatsApp Business API</h2>
        {rules}
        <ol className="steps">
          <li>In Meta Business settings, add a WhatsApp Business Account and a phone number that isn't used on the WhatsApp app.</li>
          <li>Create a System user with a permanent token (whatsapp_business_messaging, whatsapp_business_management).</li>
          <li>Add to <code>.env.local</code>: <code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code>, <code>WHATSAPP_WABA_ID</code>, <code>WHATSAPP_VERIFY_TOKEN</code> (any secret you choose) and <code>WHATSAPP_APP_SECRET</code> (App settings → Basic).</li>
          <li>For replies: set the webhook in the Meta app to <code>https://your-app-address/api/whatsapp/webhook</code> with the same verify token, and subscribe to <i>messages</i>. The app must be reachable on the internet for this (a hosted app, or a tunnel like Cloudflare Tunnel while testing).</li>
          <li>Create message templates in WhatsApp Manager and wait for approval: they're needed after 24 hours of silence.</li>
        </ol>
      </div>
    );
  return (
    <div className="otab">
      {rules}
      <div className="row gap">
        <span className={`tag ${d.webhook?.appSecret && d.webhook.verifyToken ? "good" : "warn"}`}>{d.webhook?.appSecret && d.webhook.verifyToken ? "Webhook ready" : "Webhook not set up: replies won't be seen"}</span>
        <span className="sub">Send from a lead's panel once they've replied or opted in.</span>
      </div>
      <section className="panel bsec">
        <h2>Approved templates <span className="count">{d.templates?.length ?? 0}</span></h2>
        {d.templateError && <p className="note">{d.templateError}</p>}
        {!d.templates?.length ? <p className="sub">No approved templates yet (WhatsApp Manager → Message templates).</p> : (
          <div className="qlist">{d.templates.map((t) => <div className="qrow" key={`${t.name}-${t.language}`}><div><b>{t.name}</b><span className="sub">{t.language} · {t.category.toLowerCase()} · {t.params} variable{t.params === 1 ? "" : "s"}</span></div><span className="sub tpl-body">{t.body}</span></div>)}</div>
        )}
      </section>
      <section className="panel bsec">
        <h2>Messages</h2>
        {!d.entries?.length ? <p className="sub">No messages yet.</p> : (
          <div className="qlist">{d.entries.map((e) => <div className="qrow" key={e.id}><div><b>{e.dir === "in" ? "From" : "To"} {e.leadName ?? `+${e.number}`}</b><span className="sub">{e.text ?? `Template: ${e.template}`}</span></div>{e.status && <span className="tag">{e.status}</span>}<span className="sub">{when(e.at)}</span></div>)}</div>
        )}
      </section>
    </div>
  );
}

/* ---------- LinkedIn ---------- */

type Member = { id: string; name: string; perDay: number };
type Task = { id: string; leadName: string; url: string; kind: "connect" | "find_person"; note: string; assignee?: string; due: string; status: "todo" | "done" | "skipped" | "replied"; doneAt?: string };

function LinkedInTab() {
  const [team, setTeam] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [editing, setEditing] = useState<Member[] | null>(null);
  const [copied, setCopied] = useState("");
  const today = localDate();
  const load = useCallback(() => fetch(`/api/outreach/linkedin?today=${today}`).then((r) => r.json()).then((d) => { setTeam(d.team ?? []); setTasks(d.tasks ?? []); }), [today]);
  useEffect(() => void load(), [load]);
  const mark = async (id: string, status: Task["status"]) => {
    setTasks((ts) => ts?.map((t) => (t.id === id ? { ...t, status } : t)) ?? ts);
    await fetch(`/api/outreach/linkedin?today=${today}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    load();
  };
  const saveTeam = async () => {
    await fetch(`/api/outreach/linkedin?today=${today}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ team: editing }) });
    setEditing(null);
    load();
  };
  if (!tasks) return <p className="sub">Loading…</p>;
  const todays = tasks.filter((t) => t.status === "todo" && t.due <= today);
  const later = tasks.filter((t) => t.status === "todo" && t.due > today);
  const done = tasks.filter((t) => t.status !== "todo").slice(0, 20);
  const groups = team.length ? team.map((m) => ({ key: m.id, name: m.name, perDay: m.perDay, list: todays.filter((t) => t.assignee === m.id) })) : [{ key: "all", name: "Today", perDay: 0, list: todays }];

  return (
    <div className="otab">
      <p className="sub">LinkedIn restricts accounts that send automatically, so each person opens the profile, sends the request with the ready note, and marks it done. Free accounts can add a note to only a few requests a month: if yours runs out, send without one.</p>
      <section className="panel bsec">
        <div className="row between"><h2>Team</h2>{!editing && <button className="btn sm" onClick={() => setEditing(team.length ? team : [{ id: "", name: "", perDay: 15 }])}>{team.length ? "Edit team" : "Add people"}</button>}</div>
        {editing ? (
          <>
            {editing.map((m, i) => (
              <div className="svc-row" key={i}>
                <input type="text" aria-label="Name" placeholder="Name" value={m.name} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input type="number" aria-label="Requests a day" min={0} max={40} value={m.perDay} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, perDay: Number(e.target.value) } : x)))} />
                <button className="icon-btn" aria-label={`Remove ${m.name || "person"}`} onClick={() => setEditing(editing.filter((_, j) => j !== i))}><IconClose /></button>
              </div>
            ))}
            <p className="sub">Requests a day per person: 15 keeps an account well inside LinkedIn's weekly limit (about 100).</p>
            <div className="row gap"><button className="btn sm" onClick={() => setEditing([...editing, { id: "", name: "", perDay: 15 }])}><IconPlus /> Add person</button><span className="grow" /><button className="btn sm" onClick={() => setEditing(null)}>Cancel</button><button className="btn sm primary" onClick={saveTeam}>Save team</button></div>
          </>
        ) : team.length ? (
          <p className="sub">{team.map((m) => `${m.name} (${m.perDay} a day)`).join(" · ")}</p>
        ) : (
          <p className="sub">Add the people who'll send requests: tasks are shared between them by their daily limit.</p>
        )}
      </section>

      {groups.map((g) => (
        <section className="panel bsec" key={g.key}>
          <h2>{g.name}{team.length ? "'s tasks today" : ""} <span className="count">{g.list.length}{g.perDay ? ` of ${g.perDay}` : ""}</span></h2>
          {!g.list.length ? <p className="sub">Nothing for today. In a search, tick leads and press <b>LinkedIn</b>.</p> : (
            <div className="li-list">
              {g.list.map((t) => (
                <article className="li-task" key={t.id}>
                  <div className="row between"><b>{t.leadName}</b><span className="tag">{t.kind === "connect" ? "Connect" : "Find the owner, then connect"}</span></div>
                  <p className="li-note">{t.note}</p>
                  <div className="row gap">
                    <a className="btn sm" href={safeHref(t.url)} target="_blank" rel="noreferrer"><IconLink /> Open LinkedIn</a>
                    <button className="btn sm" onClick={() => navigator.clipboard?.writeText(t.note).then(() => { setCopied(t.id); setTimeout(() => setCopied(""), 1500); }, () => {})}>{copied === t.id ? <IconCheck /> : <IconCopy />} {copied === t.id ? "Copied" : "Copy note"}</button>
                    <span className="grow" />
                    <button className="btn sm primary" onClick={() => mark(t.id, "done")}><IconCheck /> Done</button>
                    <button className="btn sm" onClick={() => mark(t.id, "replied")}>Replied</button>
                    <button className="btn sm danger-ghost" onClick={() => mark(t.id, "skipped")}>Skip</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
      {later.length > 0 && <p className="sub">{later.length} more planned for the next days (by each person's daily limit).</p>}
      {done.length > 0 && (
        <section className="panel bsec">
          <h2>Done recently</h2>
          <div className="qlist">{done.map((t) => <div className="qrow" key={t.id}><div><b>{t.leadName}</b><span className="sub">{team.find((m) => m.id === t.assignee)?.name ?? ""}</span></div><span className={`tag ${t.status === "replied" ? "good" : ""}`}>{t.status}</span><button className="linkish" onClick={() => mark(t.id, "todo")}>Undo</button></div>)}</div>
        </section>
      )}
    </div>
  );
}
