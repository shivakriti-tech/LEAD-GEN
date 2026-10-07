/**
 * Add a test lead (your own email) so you can try email sending and the inbox without a real search.
 *
 *   npm run test-lead -- you@gmail.com
 *   npm run test-lead -- you@gmail.com --name="Test Cafe"
 *
 * It saves a search called "Test leads" with one lead. Open Searches in the app, pick it, select the
 * lead and queue the email. Run it again to add another test lead to a new search.
 */
try {
  process.loadEnvFile(".env.local");
} catch {}

import { randomUUID } from "node:crypto";
import { getStore } from "../lib/store";
import type { Lead, SearchRecord } from "../lib/types";

const args = process.argv.slice(2);
const email = args.find((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
const name = args.find((a) => a.startsWith("--name="))?.slice(7) || "Test Business";
if (!email) {
  console.error("Usage: npm run test-lead -- you@gmail.com [--name=\"Test Cafe\"]");
  process.exit(1);
}

const searchId = randomUUID();
const lead: Lead = {
  id: randomUUID(),
  name,
  category: "Test",
  city: "Vadodara",
  country: "IN",
  phones: [],
  email,
  emails: [email],
  sources: [],
  signals: [],
  score: 70,
  tier: "hot",
  whyNow: "A test lead you added yourself to try emailing.",
};
const search: SearchRecord = {
  id: searchId,
  createdAt: new Date().toISOString(),
  status: "done",
  counts: { found: 1, afterDedupe: 1, hot: 1, warm: 0, cold: 0 },
  params: {
    sells: "website_development",
    categories: [],
    city: "Test leads",
    perCategory: 1,
    sources: { google: false, osm: false, apollo: false, instagram: false, facebook: false, web: false, gmaps: false },
    pageSpeed: false,
    verifyWebsites: false,
    webSearch: false,
  },
};

async function main() {
  const store = getStore();
  await store.saveSearch(search);
  await store.saveLeads(searchId, [lead]);
  console.log(`Saved test lead "${name}" <${email}> in a search called "Test leads" (${store.kind} store).`);
  console.log("Open the app → Searches → Test leads, select the lead and queue the email.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
