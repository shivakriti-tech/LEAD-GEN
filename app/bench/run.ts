/**
 * Lead-quality benchmark for Vadodara.
 *
 *   npm run bench                 all businesses (reuses earlier web searches only)
 *   npm run bench -- --fresh      nothing reused: honest timing
 *   npm run bench -- --cache      reuse website checks too (fast, but hides changes to that code)
 *   npm run bench -- --limit=30   first 30 businesses only
 *   npm run bench -- --no-search  likely web addresses only, no web search
 *
 * Prints the headline numbers, compares them with the previous run, and saves everything
 * (including each business's result) to bench/results/.
 */
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {}
const args = process.argv.slice(2);
// Default: reuse only web searches (they cost quota and don't depend on our code), so a change to
// the matching or website-check code always shows up. --cache reuses everything, --fresh nothing.
process.env.LEAD_CACHE = args.includes("--fresh") ? "off" : args.includes("--cache") ? "all" : "search";

const dir = path.join(process.cwd(), "bench");
const resultsDir = path.join(dir, "results");

async function main() {
  const { evaluate, headline, labelsFromRows, LOWER_IS_BETTER, runCases } = await import("../lib/bench");
  const { defaultDeps } = await import("../lib/pipeline");
  const { getStore } = await import("../lib/store");
  const { parseCsv } = await import("../lib/sources/gmapsScraper");
  const { providersFromEnv } = await import("../lib/enrich/searchProviders");

  const casesFile = path.join(dir, "vadodara.cases.json");
  if (!existsSync(casesFile)) throw new Error("No benchmark yet. Run: npm run bench:build");
  let cases = JSON.parse(await fs.readFile(casesFile, "utf8"));
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice(8));
  if (limit) cases = cases.slice(0, limit);
  const labelsFile = path.join(dir, "vadodara.labels.csv");
  const labels = existsSync(labelsFile) ? labelsFromRows(parseCsv(await fs.readFile(labelsFile, "utf8"))) : {};

  const deps = defaultDeps(getStore());
  const useSearch = !args.includes("--no-search");
  const search = useSearch ? deps.makeWebSearch!((m) => console.warn(`  ${m}`)) : undefined;
  console.log(`Vadodara benchmark: ${cases.length} businesses, ${Object.keys(labels).length} hand-checked, web search: ${useSearch ? providersFromEnv().map((p) => p.label).join(" → ") : "off"}, cache: ${{ off: "off", search: "web searches only", all: "everything" }[process.env.LEAD_CACHE!]}\n`);

  const started = Date.now();
  const outcomes = await runCases(cases, deps, {
    search,
    onDone: (d, t) => process.stdout.write(`\r  ${d}/${t} checked`),
  });
  const totalSec = Math.round((Date.now() - started) / 1000);
  const report = evaluate(cases, outcomes, labels);
  const now = headline(report);

  // compare with the last run
  await fs.mkdir(resultsDir, { recursive: true });
  const previous = (await fs.readdir(resultsDir)).filter((f) => f.endsWith(".json")).sort().at(-1);
  const before: Record<string, number | null> | undefined = previous ? JSON.parse(await fs.readFile(path.join(resultsDir, previous), "utf8")).headline : undefined;

  console.log(`\n\nDone in ${totalSec}s${deps.cacheStats?.hits ? ` (${deps.cacheStats.hits} saved result${deps.cacheStats.hits > 1 ? "s" : ""} reused)` : ""}.\n`);
  const w = Math.max(...Object.keys(now).map((k) => k.length));
  for (const [k, v] of Object.entries(now)) {
    const b = before?.[k];
    let delta = "";
    if (v != null && b != null && v !== b) {
      const better = LOWER_IS_BETTER.has(k) ? v < b : v > b;
      delta = `  ${better ? "▲ better" : "▼ worse"} (was ${b})`;
    }
    console.log(`  ${k.padEnd(w)}  ${v == null ? "—" : v}${delta}`);
  }
  const wrong = report.rows.filter((r) => r.verdict === "wrong");
  if (wrong.length) {
    console.log(`\nWrong websites accepted (check these first):`);
    for (const r of wrong.slice(0, 15)) console.log(`  ${r.name}: took ${r.found}, right answer ${r.truth} · ${r.evidence ?? ""}`);
  }
  const missed = report.rows.filter((r) => r.verdict === "missed");
  if (missed.length) console.log(`\nMissed ${missed.length} known websites, e.g. ${missed.slice(0, 5).map((r) => `${r.name} (${r.truth})`).join(", ")}`);

  const file = path.join(resultsDir, `vadodara-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const perBusiness = outcomes.map((o) => ({
    id: o.id, name: o.lead.name, sec: Math.round(o.ms / 100) / 10, website: o.lead.website, via: o.lead.websiteCheck?.via, evidence: o.lead.websiteCheck?.evidence,
    tried: o.lead.websiteCheck?.tried, email: o.lead.email, emailInfo: o.lead.emailInfo, phones: o.lead.phones, owner: o.lead.owner?.name,
    score: o.lead.score, tier: o.lead.tier, signals: o.lead.signals.map((s) => s.label),
  }));
  await fs.writeFile(file, JSON.stringify({ at: new Date().toISOString(), args, totalSec, headline: now, report: { ...report, rows: undefined }, websiteRows: report.rows, perBusiness }, null, 1));
  console.log(`\nSaved ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
