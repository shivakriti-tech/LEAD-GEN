import { describe, expect, it } from "vitest";
import { cleanReply, readByRules, returnDate } from "@/lib/agent/intent";
import { brainFacts, replyProblem, runAgent } from "@/lib/agent/agent";
import { handleEmailReply, memoryInboxStore, patchFor, sendEmailReply } from "@/lib/agent/inbox";
import { enqueue, memoryQueueStore, tick, type LeadAccess, type SendDeps } from "@/lib/mail/queue";
import { parseMailbox, type Mailbox } from "@/lib/mail/mailboxes";
import { mergeFollowUp, type FollowUpPatch } from "@/lib/followups";
import { parseBrain } from "@/lib/brain";
import type { Lead } from "@/lib/types";

const NOW = new Date("2026-10-05T06:00:00Z");
const MB = parseMailbox("MAILBOX_1", "smtps://riya%40getshivakriti.com:p@smtp.zoho.com:465?start=2026-09-01") as Mailbox;
const brain = { ...(parseBrain({ name: "Shivakriti Tech", offer: "website_development", services: [{ name: "Shopify store", price: "from $2,500" }, { name: "CRM / ERP" }], proof: ["Built the website and ERP for SVIL and RENP"], rules: { bannedPhrases: ["guaranteed"] }, sender: { link: "cal.com/riya" } }) as { brain: object }).brain, id: "b1", createdAt: "", updatedAt: "" } as never;
const lead = (over: Partial<Lead> = {}): Lead => ({ id: "l1", name: "Maple & Oak", category: "Fashion & apparel brand", city: "Houston", email: "jane@mapleoak.com", emails: [], phones: [], sources: ["web"], signals: [], score: 70, tier: "hot", whyNow: "Sells only on Amazon", owner: { name: "Jane Doe", via: "website" }, ...over });

describe("reading a reply by rules (no AI)", () => {
  it("strips the quoted thread and signature", () => {
    expect(cleanReply("Sounds good, call me Tuesday.\n\nOn Mon, Oct 5, 2026 at 10:00 Riya <riya@x.com> wrote:\n> Hi Jane")).toBe("Sounds good, call me Tuesday.");
    expect(cleanReply("Yes please\n--\nJane Doe\nCEO")).toBe("Yes please");
    expect(cleanReply("Thanks\n\nSent from my iPhone")).toBe("Thanks");
  });
  it("knows out of office (with the return date), unsubscribe, no, referral, wrong person", () => {
    expect(readByRules("Automatic reply: Away", "I'm out of the office and back on 14 October.", NOW)).toMatchObject({ intent: "out_of_office", sure: true, returnOn: "2026-10-14" });
    expect(returnDate("Returning Oct 3", NOW)).toBe("2027-10-03");
    expect(readByRules("Re: idea", "Please remove me from your list")).toMatchObject({ intent: "unsubscribe", sure: true });
    expect(readByRules("Re: idea", "No thanks, we already have an agency.")).toMatchObject({ intent: "not_interested", sure: true });
    expect(readByRules("Re: idea", "Please contact our ops manager at mike@mapleoak.com about this.")).toMatchObject({ intent: "referral", referral: "mike@mapleoak.com" });
    expect(readByRules("Re: idea", "I'm not the right person for this.")).toMatchObject({ intent: "wrong_person" });
    expect(readByRules("Re: idea", "Sounds good, send me details").intent).toBe("interested");
    expect(readByRules("Re: idea", "How much would a store cost?").intent).toBe("question");
    expect(readByRules("Re: idea", "What platform do you use?").intent).toBe("question");
    expect(readByRules("Re: idea", "Can we schedule a call next week?").intent).toBe("meeting");
  });
});

describe("guardrails on every draft", () => {
  it("blocks invented prices, banned phrases, placeholders and spam", () => {
    expect(replyProblem("Stores start from $2,500.", brain)).toBeUndefined();
    expect(replyProblem("It would be about $4,000.", brain)).toMatch(/price that isn't in the Business Brain/);
    expect(replyProblem("Results are guaranteed.", brain)).toMatch(/banned phrase/);
    expect(replyProblem("Hi [Name], thanks", brain)).toMatch(/placeholder/);
    expect(replyProblem("Click here: bit.ly/x", brain)).toMatch(/Spam check/);
  });
  it("the Brain facts the AI sees are short and complete", () => {
    const f = brainFacts(brain);
    expect(f).toContain("Shopify store: from $2,500");
    expect(f).toContain("SVIL and RENP");
    expect(f).toContain("Never write: guaranteed");
    expect(f.length).toBeLessThan(1500);
  });
});

describe("the agent", () => {
  const thread = (text: string) => [{ dir: "out" as const, text: "Hi Jane, I saw you sell on Amazon...", at: "" }, { dir: "in" as const, text, at: "" }];
  it("handles clear cases without calling the AI", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
    const env = { GEMINI_API_KEY: "k" };
    const ooo = await runAgent({ lead: lead(), brain, sender: {}, subject: "Out of office", thread: thread("I am out of the office until 12 October"), env, fetch: f, now: NOW });
    expect(ooo).toMatchObject({ intent: "out_of_office", handoff: false, returnOn: "2026-10-12" });
    expect(ooo.reply).toBeUndefined();
    const no = await runAgent({ lead: lead(), brain, sender: {}, subject: "Re", thread: thread("No thanks."), env, fetch: f, now: NOW });
    expect(no).toMatchObject({ intent: "not_interested", handoff: false, by: "rules" });
    expect(no.reply).toMatch(/^Hi Jane, thanks for the quick reply/);
    expect(calls).toBe(0);
  });
  it("uses Gemini for a real conversation, with a small prompt and capped answer; interested goes to you", async () => {
    let sent: { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: { maxOutputTokens: number } } | undefined;
    const f = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "interested", summary: "Asks what a store would cost", reply: "Hi Jane, a Shopify store starts from $2,500. Would a short call this week work? cal.com/riya", needs_person: false, needs_person_why: null }) }] } }] });
    }) as unknown as typeof fetch;
    const r = await runAgent({ lead: lead(), brain, sender: { name: "Riya" }, subject: "Re: idea", thread: thread("Interesting. What would it cost for us?"), env: { GEMINI_API_KEY: "k" }, fetch: f, now: NOW });
    expect(r).toMatchObject({ intent: "interested", by: "gemini", handoff: true, why: "Interested: your turn" });
    expect(r.reply).toContain("$2,500");
    expect(sent!.generationConfig.maxOutputTokens).toBeLessThanOrEqual(700);
    expect(sent!.contents[0].parts[0].text.length).toBeLessThan(3000);
  });
  it("tries GPT first and uses Gemini when GPT fails", async () => {
    const answer = JSON.stringify({ intent: "question", summary: "Asks about timing", reply: "Hi Jane, usually two weeks.", needs_person: false, needs_person_why: null });
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      return u.includes("gw.example") ? new Response(JSON.stringify({ error: { message: "No available channel" } }), { status: 503 }) : Response.json({ candidates: [{ content: { parts: [{ text: answer }] } }] });
    }) as unknown as typeof fetch;
    const env = { OPENAI_API_KEY: "o", OPENAI_BASE_URL: "https://gw.example/v1", GEMINI_API_KEY: "k" };
    const r = await runAgent({ lead: lead(), brain, sender: {}, subject: "Re", thread: thread("How long would it take?"), env, fetch: f, now: NOW });
    expect(urls[0]).toBe("https://gw.example/v1/chat/completions");
    expect(r).toMatchObject({ intent: "question", by: "gemini" });
    const ok = (async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: answer } }] })) as unknown as typeof fetch;
    expect((await runAgent({ lead: lead(), brain, sender: {}, subject: "Re", thread: thread("How long would it take?"), env, fetch: ok, now: NOW })).by).toBe("gpt");
  });
  it("a draft with an invented price is held for you", async () => {
    const f = (async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "question", summary: "Price?", reply: "It's $900 flat.", needs_person: false, needs_person_why: null }) }] } }] })) as unknown as typeof fetch;
    const r = await runAgent({ lead: lead(), brain, sender: {}, subject: "Re", thread: thread("Price for a CRM?"), env: { GEMINI_API_KEY: "k" }, fetch: f, now: NOW });
    expect(r).toMatchObject({ handoff: true, why: "Names a price that isn't in the Business Brain (900)" });
  });
  it("falls back to ready replies when the AI fails", async () => {
    const f = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as unknown as typeof fetch;
    const r = await runAgent({ lead: lead(), brain, sender: {}, subject: "Re", thread: thread("Tell me more please"), env: { GEMINI_API_KEY: "k" }, fetch: f, now: NOW });
    expect(r).toMatchObject({ intent: "interested", by: "rules", handoff: true });
    expect(r.why).toMatch(/AI not available \(Gemini's free limit/);
    expect(r.reply).toContain("cal.com/riya");
  });
  it("what each intent does to the lead", () => {
    expect(patchFor({ intent: "not_interested", summary: "No", handoff: false, by: "rules" })).toMatchObject({ status: "lost" });
    expect(patchFor({ intent: "not_now", summary: "Q1", handoff: false, by: "rules" }, NOW)).toMatchObject({ replied: true, followUpOn: "2027-01-03" });
    expect(patchFor({ intent: "unsubscribe", summary: "", handoff: false, by: "rules" })).toMatchObject({ optOut: { via: "Email: asked to unsubscribe" } });
    expect(patchFor({ intent: "out_of_office", summary: "", handoff: false, by: "rules" })).toBeUndefined();
  });
});

describe("replies end to end", () => {
  async function setup(l = lead()) {
    const patches: FollowUpPatch[] = [];
    const leads: LeadAccess = { get: async () => l, patch: async (_s, _id, p) => { patches.push(p); l.followUp = mergeFollowUp(l.followUp, p); } };
    const queue = memoryQueueStore();
    enqueue(queue.data, { searchId: "s", leads: [l], lang: "en", tone: "friendly", sender: { name: "Riya", company: "Shivakriti Tech" }, clientId: "b1", followUps: true }, NOW);
    const sent: Array<Parameters<SendDeps["send"]>[1]> = [];
    const send: SendDeps["send"] = async (_m, mail) => (sent.push(mail), { messageId: `<m${sent.length}@getshivakriti.com>` });
    await tick({ store: queue, leads, mailboxes: [MB], send, now: () => new Date("2026-10-05T06:00:00Z"), rand: () => 0 });
    const inbox = memoryInboxStore();
    const deps = { inbox, queue, leads, mailboxes: [MB], send, brainFor: async () => brain, env: {}, now: () => new Date("2026-10-06T15:00:00Z") };
    return { l, patches, queue, inbox, sent, deps };
  }
  it("out of office: no reply, and the follow-up waits until they're back", async () => {
    const { queue, inbox, deps } = await setup();
    const c = await handleEmailReply(deps, { mailbox: MB.email, address: "Jane@mapleoak.com", subject: "Automatic reply", text: "I'm out of office, back on 20 October.", messageId: "<r1@x>", at: "2026-10-06T14:00:00Z" });
    expect(c).toMatchObject({ status: "closed", agent: { intent: "out_of_office" } });
    const next = queue.data.items.find((i) => i.status === "queued")!;
    expect(next.notBefore.slice(0, 10)).toBe("2026-10-21");
    expect(next.replyCheckFrom).toBeTruthy();
    // the same message seen again isn't handled twice
    expect(await handleEmailReply(deps, { mailbox: MB.email, address: "jane@mapleoak.com", subject: "Automatic reply", text: "x", messageId: "<r1@x>", at: "" })).toBeUndefined();
    expect(inbox.data.conversations).toHaveLength(1);
  });
  it("interested: marked Replied, follow-ups stop, draft waits for you; sending replies in the thread", async () => {
    const { l, queue, inbox, sent, deps } = await setup();
    const c = (await handleEmailReply(deps, { mailbox: MB.email, address: "jane@mapleoak.com", subject: "Re: An idea for the Maple & Oak store", text: "Sounds good, tell me more", messageId: "<r2@x>", at: "2026-10-06T14:00:00Z" }))!;
    expect(c).toMatchObject({ status: "handoff", leadName: "Maple & Oak", subject: "An idea for the Maple & Oak store" });
    expect(l.followUp?.status).toBe("replied");
    expect(c.messages[0]).toMatchObject({ dir: "out" });
    const r = await sendEmailReply(deps, c.id, "Hi Jane, great. Does Thursday 10am your time work?");
    expect(r.ok).toBe(true);
    expect(sent.at(-1)).toMatchObject({ to: "jane@mapleoak.com", subject: "Re: An idea for the Maple & Oak store", inReplyTo: "<r2@x>" });
    expect(sent.at(-1)!.references).toContain("<m1@getshivakriti.com>");
    expect(inbox.data.conversations[0].status).toBe("sent");
    // the queued follow-up won't go: they replied
    expect((await tick({ store: queue, leads: deps.leads, mailboxes: [MB], send: deps.send, now: () => new Date("2026-10-12T06:00:00Z"), rand: () => 0 })).detail).toBe("They replied, so no follow-up");
    expect((await sendEmailReply(deps, c.id, "Act now! bit.ly/x")).error).toMatch(/Spam check/);
  });
  it("a polite close is sent by itself only with AGENT_AUTO_SEND=safe", async () => {
    const { sent, deps, l } = await setup();
    const before = sent.length;
    await handleEmailReply({ ...deps, env: { AGENT_AUTO_SEND: "safe" } }, { mailbox: MB.email, address: "jane@mapleoak.com", subject: "Re: idea", text: "No thanks.", messageId: "<r3@x>", at: "" });
    expect(sent.length).toBe(before + 1);
    expect(l.followUp?.status).toBe("lost");
  });
  it("ignores mail from people we never emailed", async () => {
    const { deps } = await setup();
    expect(await handleEmailReply(deps, { mailbox: MB.email, address: "news@shop.com", subject: "Sale", text: "50% off", at: "" })).toBeUndefined();
  });
});
