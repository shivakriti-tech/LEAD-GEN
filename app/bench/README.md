# Vadodara lead-quality benchmark

It measures how good and how fast the leads are, so every change to the lead engine can be checked with numbers instead of guesswork.

## 1. Build the business list

The website numbers need businesses whose real website is known, and OpenStreetMap lists very few of those in Vadodara. Google Maps lists far more, so add businesses from the Google Maps scraper (or your Google key):

```
npm run bench:build                                   # OpenStreetMap (free, thin in Vadodara)
npm run bench:build -- --source=gmaps --types=dentist,salon,cafe,restaurant,furniture,interior
npm run bench:build -- --source=google                # Google Places key: ~1 request per business type
```

- `--source=gmaps` needs the scraper running (`docker compose up -d` in `app/gmaps-scraper`, `GMAPS_SCRAPER_URL=http://localhost:8090`). Each business type takes 2–4 minutes, so start with 5–6 types. It also brings owner names.
- Each run **adds** to the list. The same business from another source (same phone or name) isn't added twice, and permanently closed ones are skipped. `--reset` starts the list again. `--per=20` sets how many per type.

It writes:

- `vadodara.cases.json`: the businesses. Many have a website listed by their source. During the benchmark that website is **hidden**, so it measures whether we find it ourselves, and whether we ever accept the wrong site. Chains (Hilton, Domino's, brand-tagged outlets) are left out of the website numbers, as in a real search, where head office decides their website.
- `vadodara.labels.csv`: your answer sheet. New businesses are added as new rows; rows you've filled in are never changed.

Needs `CRAWLER_CONTACT` in `.env.local`, the same as normal OpenStreetMap searches.

## 2. Hand-check some businesses (the part only you can do)

Open `vadodara.labels.csv` in Excel or Google Sheets. For as many rows as you can (30–50 is already useful), look the business up on Google Maps, their website, and Instagram, then fill in:

| Column | What to write |
|---|---|
| `website` | Their real website's domain (`shreefurniture.in`), or `none` if they truly have none. A Facebook/Instagram page is `none`. |
| `email` | The best email to reach them, if you find one |
| `mobile` | A mobile or WhatsApp number |
| `owner` | Owner or doctor's name, if shown anywhere |
| `pitch` | `yes` if you'd pitch them a website, `no` if not (chain, great site already, closed…) |

Leave anything you don't know blank. Blank means "not checked", not "none".

## 3. Run it

```
npm run bench              # normal run (reuses earlier web searches only)
npm run bench -- --fresh   # nothing reused: honest speed numbers
npm run bench -- --cache   # also reuse website checks (fast, but hides changes to that code)
npm run bench -- --limit=30 --no-search
```

It uses the same web search you set up for the app (SearXNG / Tavily / Brave / DuckDuckGo), so set up SearXNG first for a fair run.

## Reading the numbers

| Number | Meaning | Aim |
|---|---|---|
| website precision % | Of the websites we accepted, how many really belong to the business. A wrong site ruins the pitch. | as close to 100 as possible |
| website recall % | Of the businesses that do have a website, how many we found | higher |
| wrong websites | Count of wrong sites accepted; listed underneath so you can see why | 0 |
| businesses with a known answer | How many businesses the website numbers are based on. Under ~40 the percentages jump around a lot | 60+ |
| mobile/WhatsApp %, email %, personal email %, owner name % | How many leads you can actually contact, and how personally | higher |
| hand-checked … found % | Against your answers: did we find the right email / mobile / owner | higher |
| tier agrees with you % | Hot/Warm when you said `yes`, Cold when you said `no` | higher |
| sec per business | Speed (use `--fresh` for honest numbers) | lower |

Each run is compared with the last run on the same list of businesses (▲ better / ▼ worse); after the list changes, the first run starts a new baseline, and saved in full to `bench/results/`. That includes every business's result, what was tried, and the evidence, so you can see exactly why a site was accepted or missed. The results folder isn't committed.
