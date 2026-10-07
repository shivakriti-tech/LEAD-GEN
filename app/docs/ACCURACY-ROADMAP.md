# More accurate leads and data: research and roadmap

October 2026. What the research says, what this release ships, and what to build next, in order of value.

## What this release ships

| Change | What it fixes |
|---|---|
| **5 new niches**: Digital marketing & SEO, Rooftop solar, CA/GST & compliance, Hiring & staffing, Business insurance | Find leads for many more kinds of clients, each scored on facts we actually saw, with its own messages, report and CSV. Competitors in the same line of work score 0. |
| **16 new business types** for website searches (vet, diagnostic lab, pharmacy, optician, preschool, classes, driving school, banquet venue, photographer, travel agent, car service, car dealer, architect, jeweller, electronics, hardware) and 5 for niches (hospital, school/college, cold storage, warehouse, IT company) | More businesses per area; the list is grouped (Clinics, Food, Education…). |
| **Contact confidence** (high / medium / low) on every lead, with reasons, also in the CSV | A great lead with a dead number wastes a call. It rewards agreement between independent sources (the phone on the map listing is the one on the website), checks actually made (mailbox verified, website matched by name and phone) and freshness. |
| **Learning from your own replies** | After 30 messaged leads of one kind, each reason's reply rate is compared with your average and new leads move by up to ±15 points, with the evidence on the lead ("leads with no website replied 2.1× as often, 9 of 30"). Smoothed so a lucky streak doesn't swing scores. Competitors are never lifted. `LEARN_FROM_RESULTS=off` turns it off. |
| **New website facts**: analytics and ad tags (Google Analytics, Tag Manager, Meta Pixel, Google Ads), online booking, certificates (ISO, GMP, FSSAI, NABH…), staff size, already-on-solar, power-hungry work, hazardous goods | The niches score on these, and every one is quoted from the page. |

## What the research says

**Specific reasons get replies.** Messages that cite a verifiable event (a job posting, an expansion, the tech a company uses) average 15–25% reply rates against 1–5% for generic outreach; 50–125-word emails get about 2.4× the replies of 200+ words; 42% of replies come from follow-ups, and 4–7 touches get about 3× the responses of 1–3 ([Autobound](https://www.autobound.ai/blog/cold-email-guide-2026), [Apollo](https://apollo.io/insights/whats-the-expected-reply-rate-for-a-well-run-outbound-cold-email-campaign)). The app's "why now" lines and short messages already follow this; the gap is the number of touches (we stop at 3).

**Data goes bad fast.** B2B contact data decays 30–70% a year depending on industry and place ([Technology.org](https://www.technology.org/2026/09/08/how-better-b2b-data-improves-lead-generation-results/), [Growleads](https://growleads.io/blog/data-accuracy-and-privacy-in-b2b-lead-generation-best-practices/)). Re-check before sending; the saved directory's 7-day / 30-day windows and the new "checked N days ago" confidence penalty cover this.

**Email verifiers can't confirm catch-all domains.** In 2026 tests ZeroBounce scored 97.8% accuracy and MillionVerifier 96.4%, but they resolved only about 8–12% of catch-all addresses ([Instantly benchmark](https://instantly.ai/blog/2026-email-verification-benchmark-accuracy-scores-for-8-top-tools/), [ZoomInfo comparison](https://pipeline.zoominfo.com/sales/neverbounce-vs-zerobounce)). Treat catch-all as "unconfirmed" (confidence now does) and keep catch-all sends a small share of each day's mail.

**Google reviews decide local visibility.** Review signals carry about 16% of local-pack ranking weight; 30–50 reviews is now the competitive floor, and recency and owner replies matter ([Stacc](https://thestacc.com/blog/google-reviews-2026-ranking-signals/), [UENI](https://ueni.com/blog/how-reviews-impact-local-seo-rankings/)). This drives the marketing niche's "few reviews" and "low rating" signals.

**Google Places costs depend on the fields you ask for.** Text Search Pro is about $32 per 1,000 calls; asking for ratings moves a call to Enterprise (~$35), asking for reviews to Enterprise + Atmosphere (~$40) ([Open Places API](https://openplacesapi.com/blog/google-places-api-pricing)). In India Google gives up to $6,800 of free usage a month across Maps products ([Google](https://blog.google/intl/en-in/products/explore-communicate/helping-developers-in-india-build-more-with-google-maps-platform/)). Review dates (`publishTime`) would give review velocity, at the higher SKU.

**There are free sources we don't use yet.**
- **Overture Maps Places**: 64M+ places worldwide including India, released monthly, with websites, phones, socials and a 0–1 confidence that the place exists; free under CDLA-Permissive, read with DuckDB from GeoParquet ([Overture docs](https://docs.overturemaps.org/guides/places), [release notes](https://docs.overturemaps.org/blog/2026/06/17/release-notes/)).
- **Ola Maps**: Places and geocoding with a free tier of 5 million calls a month per API ([Ola Krutrim](https://tech.olakrutrim.com/ola-maps-made-for-india-priced-for-india/)).
- **MCA company master data** on data.gov.in: CIN, registration date, status, paid-up capital for about 3.67M companies, with month-wise new registrations ([Apify mirror description](https://apify.com/nexgendata/india-mca-companies-director-filings-ogd)). A "registered last month" list is a ready-made new-business trigger for the accounting, insurance and staffing niches.
- **GSTIN verification APIs** return legal name, trade name, registration date and active/cancelled status in about 2 seconds, from about $1.20 per 1,000 ([MessageCentral](https://www.messagecentral.com/blog/gst-verification-api-india)). An active GST registration confirms the business is real; a cancelled one should drop it.

**Rooftop solar targets are well defined.** Commercial and industrial users with high tariffs (factories, warehouses, hospitals, hotels, schools) drive the market; industry holds over half of rooftop demand ([Nexdigm](https://www.nexdigm.com/market-research/insights/blog/india-solar-rooftop-installation-industry/), [Crompton](https://www.crompton.co.in/blogs/solar-rooftop-guide/commercial-rooftop-solar-market)). That's the solar niche's list.

**Calibrate scores on outcomes.** Weights should come from won/lost history, not intuition; logistic regression is transparent and suits small datasets, and isotonic calibration makes "score 30" mean about a 30% chance ([Saber](https://www.saber.app/glossary/lead-score-calibration), [arXiv](https://arxiv.org/pdf/2002.10199)). The shipped learning step is the small-data version of this.

**India's DPDP Rules apply to B2B contacts.** The Rules were notified on 14 November 2025 with an 18-month phase-in. A work email or direct number tied to a person is personal data, and "legitimate use" doesn't cover broad cold marketing ([PIB](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf), [ComplyDP](https://www.complydp.com/articles/does-dpdp-apply-to-b2b-customer-data), [Seclore](https://www.seclore.com/fundamentals/dpdp-rules-2025-compliance-guide/)). The app already stops every channel after an opt-out and logs each message. Before the deadline: a "delete this person" action, automatic deletion of never-contacted leads after a few months, and a privacy-notice link in emails. Get legal advice on how this applies to your outreach.

## What to build next (most value first)

### 1. Quick wins (days)
1. **"Wrong details" button on a lead** (wrong number, closed, not the owner). It turns beta feedback into a measured accuracy rate per source and feeds contact confidence.
2. **GST check** for Indian leads with a GSTIN on their site or invoice pages: drop cancelled registrations, use the registration date as a "new business" signal.
3. **A 4th touch on another channel**: after the last email, a LinkedIn task or a call reminder. Research says 4–7 touches triple responses.
4. **Message variants with reply tracking**: two openers per niche, alternated, with replies counted per variant. The learning step then picks the better one.
5. **Catch-all cap**: at most ~20% of each day's emails to catch-all or unverified addresses, to keep bounces under 2%.

### 2. More, cheaper data (1–2 weeks each)
6. **Overture Maps as a free source** (DuckDB over GeoParquet, filtered to the search's bounding box), merged with the existing de-duplication. Its confidence score feeds contact confidence.
7. **Ola Maps Places** for India (5M free calls a month): many more businesses than OpenStreetMap at no cost.
8. **MCA new-company feed**: monthly list of new companies by city and industry, as ready leads for the accounting, insurance, staffing and website niches.
9. **Review velocity** for the marketing niche (Places `reviews.publishTime`, only on leads already shortlisted, to keep the higher SKU cheap).

### 3. Smarter scoring (once there are 200+ outcomes per niche)
10. **Logistic regression per niche** on your own outcomes, with calibrated probabilities ("score 70 ≈ 1 in 5 reply").
11. **Best time to send** per niche and city, from reply timestamps.
12. **Precision dashboard**: per source and per niche, what share of "strong" leads replied, extending `npm run bench`.

### 4. More niches (same framework, about a day each)
- **Packaging & printing**: online sellers, food processors and exporters (sells online, ships parcels, FSSAI, new products).
- **CCTV, security & fire safety**: warehouses, schools, hospitals, jewellers, factories (stock held, NABH/fire NOC, hazardous goods).
- **AC / HVAC maintenance contracts**: hospitals, hotels, IT offices, cold storage (24×7 load, big sites).
- **Trademark & legal for new brands**: new businesses and D2C brands (new domain, sells online, no ® on the site).
- **Billing / POS software**: restaurants, retail and pharmacies (no online ordering, several outlets, busy).
- **Facility management & cleaning**: hospitals, schools, offices and malls (big sites, many staff, low ratings mentioning cleanliness).

## How to measure accuracy in the beta

| Measure | Target | Where |
|---|---|---|
| Wrong-contact rate (wrong number, closed, not reachable) | under 10% of contacted leads | "Wrong details" button (to build), until then a note on the lead |
| Email bounce rate | under 2% | Outreach → Email |
| Reply rate on strong leads vs worth-a-try | strong at least 2× | Home → Reply rate, by tier |
| Time to the first lead worth messaging | under 2 minutes | Search run panel |
| Share of strong leads with high contact confidence | over 60% | CSV "Contact confidence" column |
