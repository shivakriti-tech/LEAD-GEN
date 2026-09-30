"use client";

import { useEffect, useRef } from "react";
import type { Config } from "./SearchForm";
import { IconClose } from "./icons";

/** What's connected, in plain words, with the setup steps kept out of the main screen. */
export function SetupPanel({ config, onClose }: { config: Config | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeFn.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows: Array<{ name: string; ok: boolean; status: string; how?: string }> = [
    { name: "Google Maps (official)", ok: !!config?.google, status: config?.google ? "Connected" : "Not set up", how: "Add GOOGLE_PLACES_API_KEY to .env.local (README → Keys). Best source for Indian cities: most businesses come with their website listed." },
    { name: "OpenStreetMap", ok: !!config?.contact, status: config?.contact ? "Ready" : "Needs your email", how: config?.contact ? undefined : "Set CRAWLER_CONTACT in .env.local to your real email, or OpenStreetMap may block searches." },
    ...(config?.searchUsage ?? []).map((u) => ({
      name: `Web search: ${u.label}`,
      ok: !u.limit || (u.limit.per === "day" ? u.today : u.month) < u.limit.n,
      status: u.limit ? `${u.limit.per === "day" ? u.today : u.month} of ${u.limit.n} free ${u.limit.per === "day" ? "today" : "this month"}` : `${u.today} today`,
    })),
    { name: "Better web search (Serper)", ok: !!config?.searchUsage?.some((u) => u.exact), status: config?.searchUsage?.some((u) => u.exact) ? "Connected" : "Optional", how: config?.searchUsage?.some((u) => u.exact) ? undefined : "Add SERPER_API_KEY to .env.local: 2,500 free Google searches, finds far more websites (README → Web search)." },
    { name: "Mobile speed (PageSpeed)", ok: !!config?.pageSpeedKey, status: config?.pageSpeedKey ? "Key set" : "No key", how: config?.pageSpeedKey ? undefined : "Add PAGESPEED_API_KEY to .env.local; without it only a few checks work." },
    { name: "AI reading (client websites)", ok: !!config?.ai, status: config?.ai ? `${config.ai} connected` : "Optional", how: config?.ai ? `${config.ai} reads a client's website to draft their Business Brain (services, prices, rules).` : "Add GEMINI_API_KEY to .env.local (free: aistudio.google.com → Get API key) so a client's website is read by AI when you add them. ANTHROPIC_API_KEY (Claude) works too. Without either, a basic reader drafts the profile for you to finish." },
    { name: "Sending email", ok: !!config?.mailboxes, status: config?.mailboxes ? `${config.mailboxes} mailbox${config.mailboxes === 1 ? "" : "es"}` : "Not set up", how: config?.mailboxes ? "See Outreach → Email for warm-up, domain health and the queue." : "Add MAILBOX_1=smtps://you%40sendingdomain.in:app-password@smtp.host:465 to .env.local (Outreach → Email shows how)." },
    { name: "WhatsApp Business API", ok: !!config?.whatsapp, status: config?.whatsapp ? "Connected" : "Optional", how: config?.whatsapp ? "For leads who replied or opted in (Outreach → WhatsApp)." : "Meta's Cloud API for leads who replied or opted in: WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID (Outreach → WhatsApp shows how). First hellos stay on your own phone." },
    { name: "Email check (mailbox level)", ok: !!config?.emailVerify, status: config?.emailVerify ? `${config.emailVerify} connected` : "Optional", how: config?.emailVerify ? "The best email on each lead is checked (up to 50 a search, remembered 30 days)." : "Every email's domain is already checked for a mail server. To also check the mailbox exists, add EMAIL_VERIFY=zerobounce and EMAIL_VERIFY_KEY (100 free checks a month) to .env.local, or EMAIL_VERIFY=millionverifier." },
    { name: "Instagram details (Meta)", ok: !!config?.meta, status: config?.meta ? "Connected" : "Optional", how: config?.meta ? undefined : "Add META_ACCESS_TOKEN and IG_BUSINESS_ACCOUNT_ID (README → Instagram setup) to read followers, last post and bio website." },
    {
      name: "Saved lead directory",
      ok: !!config?.directory?.sets,
      status: config?.directory ? (config.directory.sets ? `${config.directory.businesses.toLocaleString("en-IN")} businesses in ${config.directory.areas} area${config.directory.areas === 1 ? "" : "s"}` : "Empty") : "Off",
      how: config?.directory
        ? `Searches start from businesses already checked here, recheck the old ones and add new ones. Fill it ahead of time with: npm run prefill (Vadodara; free sources). ${config.directory.lastSaved ? `Last filled ${new Date(config.directory.lastSaved).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.` : ""}`
        : "Turned off with LEAD_DIRECTORY=off.",
    },
    { name: "Saving searches", ok: true, status: config?.store === "supabase" ? "Supabase database" : "On this computer (.data folder)" },
  ];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="drawer-head">
          <div className="drawer-title">
            <h2 id="setup-title">Sources & setup</h2>
            <span className="sub">What the app can use right now. Changes go in <code>.env.local</code>; restart the app afterwards.</span>
          </div>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close"><IconClose /></button>
        </header>
        <ul className="setup-list">
          {rows.map((r) => (
            <li key={r.name}>
              <span className={`dot ${r.ok ? "on" : ""}`} />
              <div>
                <div className="row between"><b>{r.name}</b><span className="sub">{r.status}</span></div>
                {r.how && <p className="sub">{r.how}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
