# How the paid lead tools work, and what we took from them

October 2026. A study of Apollo.io, Hunter, ZoomInfo and Clay from their public API documentation, help pages, independent tests, open-source tools and tutorials, and what this release builds from it. It sits beside [ACCURACY-ROADMAP.md](ACCURACY-ROADMAP.md).

## Why public sources, not a reverse-engineering tool

We looked at [REA](https://github.com/morluto/rea), an MCP server for reverse engineering. It inspects things that run on your own machine: native binaries, JavaScript and Electron apps, .NET assemblies, and pages open in your own browser. Apollo's lead finding, scoring and data run on Apollo's servers, so no tool on our side can see them; at most it would see the web app's screens and its calls to Apollo's API. Doing that would also break Apollo's terms, which forbid reverse engineering its products and "proprietary algorithms, data compilation methods" ([Terms](https://www.apollo.io/terms), [API terms](https://www.apollo.io/terms/api)), and REA's own [disclaimer](https://github.com/morluto/rea/blob/main/DISCLAIMER.md), which rules out copying proprietary software. Their public documentation turned out to describe the methods in more detail than a client-side trace could.

## What the research says

### Where the data comes from
- **Apollo** names four channels: a contributor network of 2M+ users whose connected inboxes, CRMs and uploads share business contacts; its engagement tools, which use reply and bounce tracking to tell valid addresses from invalid ones; crawlers over public websites; and data vendors, 200M+ records a month ([Apollo Data Overview](https://knowledge.apollo.io/hc/en-us/articles/45824429846669), [contributor network](https://knowledge.apollo.io/hc/en-us/articles/20727684184589-How-Data-Sharing-Works-with-the-Apollo-Data-Contributor-Network)).
- **ZoomInfo**'s own job posts describe "deterministic pipelines that weigh and age competing sources and pick a winner per attribute", moving to AI agents that propose answers with a verification layer deciding what gets published ([summary of postings](https://4dayweek.io/job/principal-product-manager-person-data-and-ai-evaluations-at-zoominfo-31f8dae4)).
- **Hunter** crawls public pages and keeps, for every address, each page it was seen on with `extracted_on`, `last_seen_on` and `still_on_page` ([Hunter API](https://hunter.io/api-documentation/v2)).

**For us:** we can't have a 2M-user inbox network, but the saved lead directory is the same idea at local scale (every search makes the next one faster and fresher), and our live check at search time is fresher than any stored database. Contact confidence already rewards agreement between independent sources, ZoomInfo-style.

### Finding a person's email
- Apollo's enrichment API returns `email_status` and `extrapolated_email_confidence`: an address it worked out rather than saw, with a confidence ([People Enrichment](https://docs.apollo.io/reference/people-enrichment)). Search can filter by status, including "guessed" ([Nexla connector docs](https://docs.nexla.com/user-guides/connectors/apollo_api/apollo_api_data_source)).
- Hunter's Domain Search returns the domain's `pattern` (e.g. `{first}.{last}`); Email Finder takes a name and a domain and returns the likely address with a score; "confidence depends on the number and quality of sources" ([Hunter API](https://hunter.io/api-documentation/v2)).
- Patterns vary by company: first.last leads at some, first initial + last name at others ([AddToCRM examples](https://addtocrm.com/email-format/deloitte)). Small teams often just use the first name ([Fit Small Business](https://fitsmallbusiness.com/business-email/)). No reliable public statistics exist for firms under 10 people, so our starting order is a judgement call that the domain's own addresses override.

**Gap we had:** the app only used addresses printed on the site. Many leads have a named owner and their own domain but only info@ or nothing. **Built now** (see below).

### Verifying an email
- The common recipe: syntax, MX records, an SMTP conversation that asks for the mailbox and hangs up, and a random address to detect domains that accept everything (catch-all) ([Reacher, MIT](https://github.com/reacherhq/check-if-email-exists), [Tomba on Apollo](https://tomba.io/blog/apollo-email-verification)). Hunter also flags gibberish, webmail, disposable and blocked checks ([Hunter API](https://hunter.io/api-documentation/v2)).
- Reality check: a 100,000-contact test of Apollo exports found 73.2% valid, 18.4% catch-all, 5.8% invalid. Companies of 1–10 people did worst (64.3% valid) ([BounceZero study](https://bouncezero.io/apollo-email-accuracy-study-2026), a verification vendor, so read with care). Cold lists on Apollo-verified data often bounce 3–9%, against the under-2% providers want; B2B data decays 2–3% a month.
- Catch-all addresses can't be confirmed by SMTP; bad ones bounce later. Scoring guidance: firstname.lastname is lower risk than random strings or role addresses ([Deepline](https://deepline.com/gtm-stack/questions/how-should-i-handle-catch-all-emails-6cb4aS), [BounceZero](https://bouncezero.io/catch-all-email-verification-2026)).

**For us:** the app already had ZeroBounce, MillionVerifier and a free SMTP check with a catch-all probe. Small local businesses are exactly where the big databases are weakest, which is our market. What was missing was a per-address confidence and a rule for guesses. **Built now.**

### Waterfall enrichment
- Apollo checks its own database first, then the providers you connected, in your order, until one returns an email or phone; you choose whether to stop at any email or only a verified one; one optional validator runs after; credits are charged per attempt ([Apollo docs](https://docs.apollo.io/docs/enrich-phone-and-email-using-data-waterfall), [FullEnrich on Apollo's waterfall](https://fullenrich.com/content/apollo-waterfall-enrichment), a competitor). Clay does the same across 100+ providers, and its Claygent agent researches the web per row ([Vantaige](https://vantaige.io/blog/how-clay-works-waterfall-enrichment-2026)).

**For us:** web search already works this way (SearXNG → Serper → Tavily → … each stopping at its free limit). A verification waterfall (free SMTP first, paid service only for "unknown") is a good next step.

### Scoring and timing
- Apollo Scores combine rules you set with AI scores "generated based on your company website and prospecting activity" ([Scores Overview](https://knowledge.apollo.io/hc/en-us/articles/4988048582285)). Intent topics are bought data, shown as High/Medium/Low ([review](https://lemlist.com/blog/apollo-io-review), [tips guide](https://blog.reviewaitool.com/?p=299)).
- For small data, logistic regression is the usual choice; priors (shrinkage) help most when data is small; test on newer data than you trained on ([Octave](https://www.octavehq.com/post/gtm-engineers-guide-to-predictive-lead-scoring), [Bayesian credit scoring thesis](https://researchrepository.ru.ac.za/handle/123456789/4317)).
- Clay and Apollo time outreach on triggers: job changes, funding, hiring, news.

**For us:** our "why now" signals (no website, site down, hiring, new branch, young domain) are triggers the big tools can't see for local businesses. The learning step added up each reason's reply rate; it double-counted reasons that come together and ignored business type. **Rebuilt now.**

### Tutorials
The YouTube walkthroughs ([How to Use Apollo.io 2026](https://www.youtube.com/watch?v=QnSW0B2oztg), [Filters & Export](https://www.youtube.com/watch?v=oxmrg6Hnhnc), [Apollo + Clay](https://www.youtube.com/watch?v=2K7vbGYqBjg)) show the user's side: layer filters (industry, location, size, technologies), filter by email status "verified", then intent. They don't show how scores are computed.

## What this release ships

| Change | Taken from | What it does |
|---|---|---|
| **Owner email finder** (`lib/enrich/emailFinder.ts`) | Apollo extrapolated emails, Hunter Email Finder | With the owner's name and the business's own domain: lists likely addresses, first in the pattern the domain already uses, checks up to 2 with your verifier, and makes a confirmed one the lead's email. |
| **Owner names from the website** (`lib/enrich/names.ts`) | Hunter's per-person data | "Founder: Rahul Shah", "Jane Doe, CEO", or the one doctor named in full on a clinic's site. Names that are the business's own words are rejected, also for Google Maps' owner field. |
| **How sure we are of each email** (0–100%) and where it was found | Hunter confidence score | Shown on the lead and in the CSV ("Email found", "Email sure (%)", "Likely owner email (not confirmed)"). |
| **Learned scoring model** (`lib/learn.ts`) | Apollo AI scores; predictive lead scoring | A logistic regression on your own replies, with reasons and business types, shrinkage, recency weighting, and a test on your newest leads before it's used. |
| Time-bombed directory tests fixed | – | The saved directory's age check now uses the search's clock, so the tests don't fail as the calendar moves. |

## A second look before building (what changed in the plan)

1. **A guess is never emailed unconfirmed.** First plan: add guesses to the lead's emails. Rejected: one bounce too many pauses a sending mailbox (over 3% a week), and catch-all guesses are the riskiest addresses there are. An unconfirmed guess lives apart (`emailGuess`), is shown as "likely", and never reaches the send queue.
2. **Credits.** Guess checks share the existing 50-a-search verification limit, at most 2 a lead, stopping on the first "accepts any address" answer (more checks can't tell addresses apart there), skipping domains with no mail server, chains, and leads whose owner address we already have.
3. **Names are conservative.** The owner name goes into the greeting ("Hi Rahul"), so a wrong name is worse than none: only names next to a role word, or a single fully named doctor; team pages with several doctors give nothing.
4. **The model has to earn its place.** If, trained on older leads, it can't rank your newest ones better than a coin flip (AUC under 0.55), it changes nothing and the search log says so.
5. **Dropped for now:** review-growth signals (saved rechecks don't call Google again, so review counts rarely change between checks) and choosing the phone number by agreement (it could change which number WhatsApp uses; needs its own UI work).

## Next, in order of value

1. **Verification waterfall:** free SMTP check first, ZeroBounce/MillionVerifier only for "unknown" answers, so credits go where the free check can't answer.
2. **Replies and bounces feed back into email status:** a reply proves the address (mark it verified for the directory and the next searches); a bounce marks it invalid on the lead, not only in the suppression list. This is Apollo's engagement loop.
3. **Domain pattern memory:** when a guessed address is confirmed or replies, remember the domain's pattern for other people at the same company (multi-contact outreach to larger firms in the agency track).
4. **Phone by agreement:** prefer the number that the listing, the website and Instagram agree on, ZoomInfo-style, with a visible note when it changes.
5. **Review velocity** once Google is re-called for shortlisted leads (see the roadmap's Places SKU note).
