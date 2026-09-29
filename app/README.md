# Lead Autopilot — Module 1: Lead Finder

Finds local businesses that need a new or better website, checks their website, collects contacts and scores each lead 0–100 with a plain-English reason to pitch them now.

## Run it on your computer (Windows)

You need Node.js 20 or newer (https://nodejs.org). Then, in a terminal opened in this `app` folder:

```
npm install
copy .env.example .env.local
npm run dev
```

Open http://localhost:3000.

With no keys at all it already works: leads come from OpenStreetMap (free) and every website is checked. For many more businesses, add a Google key (next section).

## Keys (all optional) — put them in `.env.local`

| Key | What it adds | How to get it |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Maps businesses with phone, website, rating, reviews. 1,000 free requests a month, about 20 businesses each | Google Cloud Console → new project → turn on billing → APIs & Services → enable **Places API (New)** → Credentials → Create API key. Restrict the key to Places API. Set a budget alert. |
| `PAGESPEED_API_KEY` | Mobile speed check for every website (turns on automatically when set) | Same project → enable **PageSpeed Insights API**. If you reuse the Places key and restricted it, add PageSpeed Insights API to the key's allowed APIs, or Google rejects it (the app now shows this error). |
| `SERPER_API_KEY` | Google results through Serper: 2,500 free searches once (no card), then paid | https://serper.dev |
| `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` | Google Programmable Search: only for accounts that already have it (closed to new sign-ups; ends 1 Jan 2027) | See **Web search** below |
| `SEARXNG_URL` | Free, unlimited web search running on your own computer. Used to find missing websites and Instagram/Facebook profiles | See **Web search** below |
| `TAVILY_API_KEY` | 1,000 free web searches a month, no credit card | https://app.tavily.com → sign up → copy the API key |
| `BRAVE_SEARCH_API_KEY` | Another search option. Needs a card on file | https://brave.com/search/api/ |
| `META_ACCESS_TOKEN`, `IG_BUSINESS_ACCOUNT_ID` | Instagram followers, last post and bio website for each business profile, through Meta's official API | See **Instagram setup** below |
| `FB_PAGE_SEARCH` | Official Facebook Page search (address, phone, website). Leave `off` until Meta approves your app | Needs Meta App Review + business verification for "Page Public Metadata Access" |
| `APOLLO_API_KEY` | Company size and LinkedIn page. Only the client's own key | Apollo → Settings → API. You can also paste it in the app for one search. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Save searches in a real database instead of the `.data` folder | supabase.com → new project → SQL Editor → run `supabase/schema.sql` → Project Settings → API |
| `CRAWLER_CONTACT` | Your email in the crawler's User-Agent (OpenStreetMap asks for one) | Any address you check |
| `APP_PASSWORD` | Password-protects the whole app (the browser asks; any user name). **Set it before putting the app online**: saved searches hold phone numbers and emails, and every search spends your API quota | Any long password |

Restart `npm run dev` after changing `.env.local`.

## Using the Lead Finder screen

- **Look and feel:** a warm off-white canvas, stone panels holding white cards, near-black text and one ember-orange accent for the main action and the charts. Pill tabs across the top (Home, Find leads, Searches, Setup), a rail of quick actions on the left (new search, follow up today, recent searches, export), a bell with the number of follow-ups due, and your initials to edit *Your details*. On a phone the tabs become a bar at the bottom.
- **Home** (the first screen once you have searches) greets you with what to do today, then: **Summary** (messages sent and replies, this week in orange beside last week in sand; switch to Monthly for 8 weeks), **Pipeline** (awaiting reply, in talks, each with a 14-day trend, and a dark **Follow up** card with how many are due, how many overdue and a mini chart of the week ahead), **Reply rate** and **Won** (₹, from the deal value you enter when you mark a lead Won), a tip from your own results, and one list with three tabs: **Follow up** (WhatsApp follow-up ready, remind tomorrow, done), **Message next** (top leads from all searches not messaged yet) and **Recent**. Every status change is saved with its date so these numbers are real; leads saved before this rebuild their history from their dates.
- **New search** asks three questions. *Where should we look?* (an area and city; recent places are one tap). *What kind of business?* (cards with why each type is worth pitching; after a few searches they show your own results, e.g. "Last time: 7 of 13 had no working site", and a *Pitches well* tag). *Keep only the useful ones*: hide businesses you've already messaged (in any search, matched by phone number and Google listing), skip chains, only with a phone, only 4★ and above. These start as filters on the results, so nothing is thrown away. Sources and website checks are under *More options*.
- **The summary box** beside the form (a bar at the bottom on a phone) shows what you picked, an estimate from your own past searches ("about 7 businesses, 4 worth messaging first"), how many free web searches you have left, and warns if you ran the same search recently, with a link to open it.
- **While it runs** you see a checklist (finding businesses → checking each one → speed → scoring) with live counts and "Already spotted 3 without a working website". Leads appear in the list as they're checked and you can message them and change their status straight away. *Stop* keeps everything found so far.
- **Results** start with what to do: "3 businesses to message first. 2 have no working website." The cards *Message first*, *Worth a try*, *Skip for now*, *Everything* and *Contacted this week* filter the list. Filter chips: no working website, not messaged yet, has phone, WhatsApp, has email, 4★ and up, no chains, plus status, search and sort, Table/Cards, Export. Businesses you messaged in another search are tagged *Messaged before*.
- **The lead panel** (beside the list on a wide screen, sliding in on smaller ones): why it's a lead, the message, Call/Email/Map, status, follow-up date and note, *Next to message*, and all the details (contacts, website checks, why this score, how we checked). On a wide screen, keys: **J/K** next/previous, **W** WhatsApp, **C** mark contacted.
- **Messages** are written for each business: its name, its rating if it's good, the problem, what a website does for that kind of business (booking for clinics and salons, menus for cafés, fees for coaching…), who you are, and a link to your work. Pick **Friendly** (full) or **Short** (two lines), English or Hinglish; leads you've already contacted start with a **Follow-up**. Fill in *Your details* once (name, what you do, city, link). Edit any message before sending.
- **After you send on WhatsApp**, a bar asks "Sent to …?": *Mark contacted* (follow up in 3 days) or *Contacted, next lead →*.
- **Status:** New, Contacted, Replied, Meeting booked, Won, Lost, each in its own colour. Tap it to change it or set a follow-up date. **Follow up today** at the top lists leads due today or overdue from all searches, with a follow-up message ready.
- **Select leads** with the checkboxes to mark them contacted, set a status or follow-up, export or delete them (delete waits until a running search finishes).
- Every search in *Recent searches* has a download icon. On a phone everything stacks into one column with bigger buttons.

## Leads for a logistics client

Besides website clients, the app finds leads **for a logistics company** (your client): businesses that ship goods.

- In *New search*, pick **A logistics client**, type the client's company name (optional) and tick the services they offer: customs clearance, truck freight, courier and parcels, export forwarding, warehousing.
- Business types switch to ones that ship goods: manufacturer, textile & garment maker, chemical & plastics, pharma & medical, engineering & fabrication, food & agro processing, furniture maker, exporter, importer, wholesaler, distributor & stockist, online seller.
- Each business's website is read for shipping clues: exports (and to which countries), imports, an import-export code (IEC), "pan-India" supply, online selling (cart/checkout, Amazon/Flipkart links), IndiaMart/TradeIndia listings, manufacturing, dealer networks. Its address is checked for industrial estates (GIDC, MIDC, industrial area…).
- **Scoring** favours factories and exporters in industrial estates that supply across India, and only counts what the client offers (exports count for more when the client does forwarding and customs). Transporters, couriers and packers & movers are marked as competitors and score 0. Each lead says why it fits and what it will likely need, e.g. "Manufacturer in GIDC Makarpura that exports to UAE, USA and Kenya and supplies across India. Likely needs truck freight, export forwarding and customs clearance."
- **Messages** mention what we saw and the client: "I saw you export to UAE, USA and Kenya. I'm Divy from Shree Logistics… Could we quote for your next export shipment?" (Friendly, Short, Follow-up; English or Hinglish).
- **For your client:** *Export* gives a CSV with extra columns (Likely needs, Exports to, Listed on). *Report* opens a clean one-page report of the best leads (summary, why each fits, likely needs, contacts), with competitors left out; press *Save as PDF* to send it. It works for website searches too.

## How a search works

1. Searches Google Maps, OpenStreetMap, search engines (local businesses with their own website, through SearXNG/Tavily), and Instagram business profiles and Facebook Pages for each business type in the city/area. Search-engine results are only kept if the site is a local business: directories, national online stores, news sites and chains are skipped, and the homepage must mention the city or area.
2. Merges duplicates (same phone, same website, same Instagram/Facebook profile, same name within 150 m, or the exact same name in the same city for social results) and drops permanently closed businesses.
3. Marks chains: the same name at 2+ places in the search, a brand tag on the map, or a website that talks about outlets/franchising. Chains stay in the list but score low.
4. **Shows every business right away,** marked "checking…", then checks them 8 at a time and updates each one on screen as soon as it's done. The search keeps running and saves as it goes if you close the tab; open it again from *Recent searches* to watch its progress and log. **Stop** ends it early and keeps everything checked so far. Every search, finished or not, can be exported to CSV (unchecked businesses are marked in a "Checked" column). A search cut off by closing the app shows as *stopped*.
5. **Doesn't trust "no website" from the map.** For every business without a website it tries likely web addresses (teapost.com, teapost.in…), a web search for the name (and its phone number, with `PHONE_SEARCH=on`), and only accepts a page that shows the business name plus its phone number or its area. Each lead shows what was checked.
6. Opens each website (plus up to 2 contact/about pages): emails, phones, WhatsApp, Instagram/Facebook, owner name, year founded, the agency that built it, HTTPS, mobile-ready, copyright year, site builder, parked/broken pages.
   Emails are ranked (an owner's own address before info@) and checked for a mail server, so a dead address is never the one shown first.
7. Instagram: with a Meta token, reads each business profile (followers, last post, bio website). A website in the bio is verified like any other; an active account with no website becomes a stronger lead.
8. Optional: Google PageSpeed mobile score.
9. Optional: Apollo company data (your key).
10. Scores each lead for **website development** and writes the "why now" line.
11. Saves the search. Export to CSV from the results.

## Web search

The app searches the web to find websites the map missed and to find Instagram/Facebook profiles. It uses the best option you've set up first. Each one stops at its free limit (counted per day/month in `.data/usage.json` and shown in the app's side panel), and the next one takes over, so nothing is ever billed by surprise.

**Google-quality (best results, free allowances).** These match exact business names and phone numbers, which the free engines below don't. The phone-number search stays off unless you set `PHONE_SEARCH=auto` (even through Serper it found 1 site in 69 searches in the Vadodara benchmark):

- **Serper** (recommended): Google results through https://serper.dev. New accounts get 2,500 free searches, once, with no card; after that you buy credit packs. Key in `SERPER_API_KEY`. Without a card on file it simply stops working when the free searches are used up, so it can't bill you. One benchmark run uses about 200.
- **Google Programmable Search** (`GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`): only if your Google account already has it. Google closed it to new sign-ups in 2025 and shuts it down on 1 January 2027.

**Free, unlimited or large allowances:**

1. **SearXNG** (free, unlimited, no signup): a search engine that runs on your own computer.
   - Install Docker Desktop: https://www.docker.com/products/docker-desktop/
   - Open a terminal in `app/searxng` and run `docker compose up -d`
   - Add `SEARXNG_URL=http://localhost:8888` to `.env.local`
   - Check it works: open http://localhost:8888 in your browser
   - Change `secret_key` in `searxng/settings.yml` to any long random text.
   SearXNG asks Google, Bing and others on your behalf, so very heavy use can still get your internet connection rate-limited by them. For normal lead searches it's fine.
2. **Tavily**: sign up at https://app.tavily.com (no card), copy the key into `TAVILY_API_KEY`. 1,000 searches a month.
3. **Brave**: optional, needs a card.
4. **DuckDuckGo**: always the last fallback. Free, but it blocks after a few dozen searches.

A typical search uses about 1 web search per business without a website (2 with `PHONE_SEARCH` on), plus 2 per business type for the search-engine source, 1 for Instagram and 1 for Facebook.

Change the order with `SEARCH_ORDER` (e.g. `searxng,google_cse` to save Google's allowance for last) and the limits with `SEARCH_LIMITS` (e.g. `google_cse=100/day,serper=2500/month`).

## Moving to paid tools later

Every outside service is a plug, so upgrading means adding a key, not changing the lead engine:

| What | Free now | Paid later | Where |
|---|---|---|---|
| Businesses (the lead list) | OpenStreetMap; Google Maps scraper (local testing only) | Google Places API (`GOOGLE_PLACES_API_KEY`): official, lists the website for most businesses | `lib/sources/` |
| Web search (finding websites, phone search) | SearXNG, Tavily free, DuckDuckGo; Serper's 2,500 free searches | Serper credit packs, or Brave: raise `SEARCH_LIMITS` | `lib/enrich/searchProviders.ts` |
| Mobile speed | PageSpeed without a key (few checks) | PageSpeed key (free quota is large) | `lib/enrich/pagespeed.ts` |
| Instagram details | – | Meta official API token | `lib/sources/meta.ts` |
| Company data | – | Apollo (client's own key) | `lib/sources/apollo.ts` |

Run `npm run bench` before and after adding a service to see what it actually changes.

## Google Maps scraper (local testing only)

For testing on your own computer you can pull businesses straight from Google Maps with the open-source [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) (MIT licence). It returns many more businesses than OpenStreetMap, with phone, website, rating, reviews and emails, plus the owner name, price range, Zomato/Swiggy/booking links, photo count and opening hours (shown on each lead and in the CSV).

**Only for local testing.** It reads the Google Maps website directly, which is against Google's terms, and heavy use gets your internet connection blocked by Google for a while. The app switches it off automatically in any live/production build. For the live product use the official `GOOGLE_PLACES_API_KEY`.

1. With Docker Desktop running, open a terminal in `app/gmaps-scraper` and run `docker compose up -d`
2. Open http://localhost:8090 to check it's running (it has its own simple page).
3. Add `GMAPS_SCRAPER_URL=http://localhost:8090` to `.env.local` and restart `npm run dev`.
4. A dashed **"Google Maps (scraper) · Testing only"** card appears under *Where to look*.

Each business type becomes one scraper job. The scraper runs them one after another, about 2–4 minutes each, so start with 1–3 business types. Open http://localhost:8090 to watch its jobs. Results go through the same merging, website checks and scoring as every other source. Stop it with `docker compose down` when you're done testing.

## Instagram setup (about 15 minutes, free)

The app reads Instagram only through Meta's official **Business Discovery** API. It never logs in to Instagram or scrapes pages. It can read any *business or creator* account; personal accounts show as "personal account".

1. **Make your Instagram a business account and link it to a Facebook Page.** Instagram app → Settings → Account type and tools → Switch to professional account. Then link it to a Facebook Page (Page settings → Linked accounts → Instagram).
2. **Create a Meta app.** https://developers.facebook.com → My Apps → Create app → Business type. Add the **Instagram** product and choose "API setup with Facebook login".
3. **Get a token.** Open Graph API Explorer (Tools menu), pick your app, click *Generate Access Token* and tick `instagram_basic`, `pages_show_list`, `pages_read_engagement` (add `business_management` if your Page is in a business portfolio).
4. **Find your Instagram account id.** In the Explorer run `me/accounts?fields=name,instagram_business_account` and copy `instagram_business_account.id`.
5. **Make the token last 60 days.** Tools → Access Token Debugger → paste the token → *Extend Access Token*.
6. Put both in `.env.local` and restart:
   ```
   META_ACCESS_TOKEN=EAAG...
   IG_BUSINESS_ACCOUNT_ID=1784...
   ```

Your app can stay in development mode while only you use it. When clients connect their own Instagram accounts later, Meta's App Review is needed. The token expires after 60 days; the app tells you when it's rejected.

Facebook: Page search through the official API needs Meta's "Page Public Metadata Access" feature (App Review + business verification). Until then the app finds Facebook Pages through web search and keeps the link. It doesn't read Facebook pages.

## Speed

- All sources are searched at the same time, and results appear on screen before the website checks finish.
- Guessed web addresses are checked with a DNS lookup first. Most don't exist, and DNS says so in milliseconds instead of waiting for a page timeout.
- Web searches, website checks and websites found are saved in `.data/cache` and reused for up to 7 days (failed checks: 1 day). Searching the same city again is much faster. `LEAD_CACHE=off` in `.env.local` turns this off.

## Benchmark (lead quality, Vadodara)

`npm run bench:build` (add `-- --source=gmaps` or `--source=google` for many more businesses with known websites), then `npm run bench` after every change to the lead engine. It reports website precision/recall, how many leads have a mobile, email, personal email and owner name, how well the tiers match your own judgement, and seconds per business, compared with the previous run. See `bench/README.md`.

## Scoring (website development)

| Signal | Points |
|---|---|
| No website | 55 |
| Instagram/Facebook/Linktree used as website | 50 |
| Website broken or parked | 50 |
| Free builder subdomain (wixsite, blogspot, …) | 20 |
| Not mobile-friendly | 25 |
| Very slow / slow on mobile (PageSpeed < 30 / < 50) | 20 / 15 |
| No HTTPS | 10 |
| Not updated for 3+ years (copyright year) | 10 |
| Busy business (50+ reviews, 4.0★+) | 10 |
| Website built by an agency and not updated for 3+ years | 5 |
| Established business (website says running 5+ years) | 5 |
| Owner's name known (Google Maps listing or the website) | 5 |
| Has phone / has an email that can receive mail | 5 each |
| Active on Instagram (300+ followers, posted in the last 45 days) with no working website | 10 |
| Chain or franchise | −45 |

Hot ≥ 65 · Warm 40–64 · Cold < 40. Tune it in `lib/score/websiteDev.ts`.

## Project layout

```
app/page.tsx                 Lead Finder screen (app/_ui/: search form, lead card, detail panel, setup panel)
app/api/search/route.ts      runs a search, streams progress
app/api/searches/...         past searches, CSV export
lib/pipeline.ts              the whole search → merge → enrich → score flow
lib/sources/                 googlePlaces.ts, osm.ts, apollo.ts, gmapsScraper.ts (local testing only), webSearch.ts (search engines as a lead source), social.ts (Instagram/Facebook via web search), meta.ts (official Meta API)
lib/enrich/                  crawl.ts (website check), discover.ts (find missing websites), searchProviders.ts (SearXNG / Tavily / Brave / DuckDuckGo), pagespeed.ts
lib/score/websiteDev.ts      opportunity score for this niche
lib/dedupe.ts                merging duplicates across sources
lib/enrich/email.ts, mx.ts   email ranking (owner vs shared inbox) and mail-server check
lib/cache.ts                 disk cache for repeat searches
lib/outreach.ts              first messages (English/Hinglish), Call/WhatsApp/Email links, follow-up statuses
lib/bench.ts, bench/         Vadodara lead-quality benchmark (npm run bench)
lib/safeFetch.ts             blocks private/internal addresses when checking websites in a live build
proxy.ts                     password protection (APP_PASSWORD)
lib/categories.ts            business types and their search terms
supabase/schema.sql          database tables
searxng/                     free self-hosted web search (docker compose up -d)
gmaps-scraper/               Google Maps scraper for local testing only (docker compose up -d)
tests/                       npm test
```

## Rules we follow

- Google Maps data: keep `place_id` long term; refresh details from Google rather than keeping them forever.
- OpenStreetMap public servers are for light use, and results must credit "© OpenStreetMap contributors" (the app does).
- Website checks are polite: one request at a time per site, short timeouts, a clear User-Agent.
- Apollo data is only fetched with the client's own key and not reused for other clients.
- Instagram and Facebook: only search-result links and Meta's official API. No logins, no scraping of profile pages.
- Live builds never load private or internal addresses (localhost, 192.168.x, cloud metadata…) when checking a business website, even through a redirect.
- A live app must have `APP_PASSWORD` set. Keys stay on the server; the browser only learns which sources are switched on.

## Checks

```
npm test          # 194 tests: parsing, merging, scoring, full pipeline with mocked sources
npm run typecheck
npm run build
```
