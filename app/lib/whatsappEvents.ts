import { getStore } from "./store";
import { replyDeps, savedLeads } from "./mail/send";
import { handleWhatsAppMessage } from "./agent/inbox";
import { leadsWithNumber, patchForInbound, updateWaLog, waNumber, type WaEvent } from "./whatsapp";
import type { Lead, SearchParams } from "./types";

/**
 * What to do with WhatsApp events, whichever connection they came in on (Meta's webhook, or WAHA's
 * while testing): log each message, mark the leads with that number Replied (or opted out on "STOP"),
 * let the conversation agent draft an answer, and record delivery updates.
 */
export async function handleWaEvents(events: WaEvent[]): Promise<void> {
  const inbound = events.filter((e) => e.kind === "message");
  // which saved leads have these numbers (only looked up when someone wrote in)
  const all: Array<{ searchId: string; lead: Lead }> = [];
  const searches = new Map<string, SearchParams>();
  if (inbound.length) {
    const store = getStore();
    for (const s of await store.listSearches()) {
      searches.set(s.id, s.params);
      for (const lead of (await store.getSearch(s.id))?.leads ?? []) all.push({ searchId: s.id, lead });
    }
  }
  for (const e of inbound) {
    const matches = leadsWithNumber(all, e.number);
    await updateWaLog((l) => {
      l.lastInbound[waNumber(e.number)] = e.at;
      l.entries.push({ id: e.id, at: e.at, dir: "in", number: waNumber(e.number), text: e.text?.slice(0, 1000), leadName: matches[0]?.lead.name, searchId: matches[0]?.searchId, leadId: matches[0]?.lead.id });
    });
    for (const m of matches) await savedLeads.patch(m.searchId, m.lead.id, patchForInbound(e.text));
    // the conversation agent reads it and drafts an answer for the Inbox
    if (e.text && matches[0]) {
      const p = searches.get(matches[0].searchId);
      await handleWhatsAppMessage(replyDeps(), { number: waNumber(e.number), text: e.text, at: e.at, id: e.id, searchId: matches[0].searchId, lead: matches[0].lead, clientId: p?.clientId, sender: { company: p?.client?.name } }).catch(() => undefined);
    }
  }
  const statuses = events.filter((e) => e.kind === "status");
  if (statuses.length)
    await updateWaLog((l) => {
      for (const s of statuses) {
        const hit = l.entries.find((x) => x.id === s.id);
        if (hit) hit.status = s.status;
      }
    });
}
