# Vadodara lead-quality benchmark

It measures how good and how fast the leads are, so every change to the lead engine can be checked with numbers instead of guesswork.

## 1. Build the business list (once)

```
npm run bench:build
```

This pulls about 150 real Vadodara businesses from OpenStreetMap across 15 business types (`--per=20` for more per type). It writes:

- `vadodara.cases.json`: the businesses. Some have a website listed on OpenStreetMap. During the benchmark that website is **hidden**, so it measures whether we find it ourselves, and whether we ever accept the wrong site.
- `vadodara.labels.csv`: your answer sheet. It's only created if it doesn't exist, so your work is never overwritten.

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
| mobile/WhatsApp %, email %, personal email %, owner name % | How many leads you can actually contact, and how personally | higher |
| hand-checked … found % | Against your answers: did we find the right email / mobile / owner | higher |
| tier agrees with you % | Hot/Warm when you said `yes`, Cold when you said `no` | higher |
| sec per business | Speed (use `--fresh` for honest numbers) | lower |

Each run is compared with the previous one (▲ better / ▼ worse), and saved in full to `bench/results/`. That includes every business's result, what was tried, and the evidence, so you can see exactly why a site was accepted or missed. The results folder isn't committed.
