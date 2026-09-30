"use client";

import { useCallback, useEffect, useState } from "react";
import { localDate, STEP_LABEL } from "@/lib/outreach";
import { IconCheck, IconClose, IconCopy, IconLink, IconMail, IconPlus, IconUser, IconWhatsApp } from "./icons";

/**
 * Outreach: the email queue with your mailboxes and domain health, the WhatsApp Business API, and
 * the LinkedIn tasks for your team. Leads get here from the results: tick them → Email / LinkedIn.
 */

type Tab = "email" | "whatsapp" | "linkedin";
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

export function OutreachView() {
  const [tab, setTab] = useState<Tab>("email");
  return (
    <section className="outreach">
      <div className="top">
        <div>
          <h1>Outreach</h1>
          <p>Emails go out from your own mailboxes a few at a time in office hours, with follow-ups that stop when someone replies. WhatsApp's API is for people who replied or opted in. LinkedIn is a daily task list for your team.</p>
        </div>
      </div>
      <div className="seg big-seg" role="tablist" aria-label="Channel">
        <button role="tab" aria-selected={tab === "email"} aria-pressed={tab === "email"} onClick={() => setTab("email")}><IconMail /> Email</button>
        <button role="tab" aria-selected={tab === "whatsapp"} aria-pressed={tab === "whatsapp"} onClick={() => setTab("whatsapp")}><IconWhatsApp /> WhatsApp</button>
        <button role="tab" aria-selected={tab === "linkedin"} aria-pressed={tab === "linkedin"} onClick={() => setTab("linkedin")}><IconUser /> LinkedIn</button>
      </div>
      {tab === "email" ? <EmailTab /> : tab === "whatsapp" ? <WhatsAppTab /> : <LinkedInTab />}
    </section>
  );
}

/* ---------- Email ---------- */

type Check = { ok: boolean; label: string; detail: string; fix?: string };
type EmailData = {
  window: { open: boolean; hours: string };
  mailboxes: Array<{ email: string; name?: string; domain: string; startedOn: string; capToday: number; sentToday: number; lastAt?: string; error?: string; replyCheck: boolean }>;
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

      <div className="mb-grid">
        {d.mailboxes.map((m) => {
          const day = Math.max(0, Math.round((Date.parse(`${localDate()}T00:00:00Z`) - Date.parse(`${m.startedOn}T00:00:00Z`)) / 86_400_000)) + 1;
          return (
            <article className="panel mb-card" key={m.email}>
              <div className="row between"><b>{m.email}</b>{m.error ? <span className="tag bad">Paused</span> : <span className="tag good">Active</span>}</div>
              <div className="mb-meter" aria-label={`${m.sentToday} of ${m.capToday} sent today`}><i style={{ width: `${Math.min(100, (m.sentToday / Math.max(1, m.capToday)) * 100)}%` }} /></div>
              <p className="sub">Warm-up day {day}: {m.sentToday} of {m.capToday} today{m.lastAt ? ` · last ${when(m.lastAt)}` : ""}</p>
              <p className="sub">{m.replyCheck ? "Checks its inbox for replies before each follow-up" : "Reply check off: mark replies yourself"}</p>
              {m.error && <p className="pitch-warn">{m.error}</p>}
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
                    <a className="btn sm" href={t.url} target="_blank" rel="noreferrer"><IconLink /> Open LinkedIn</a>
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
