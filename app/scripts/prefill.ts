/**
 * Fill the lead directory ahead of time, so searches in these areas start from checked businesses.
 *
 *   npm run prefill                         Vadodara: website areas and industrial estates (free sources)
 *   npm run prefill -- --dry                just show what would run
 *   npm run prefill -- --offer=logistics    only the logistics areas and types (or --offer=website)
 *   npm run prefill -- --area="Alkapuri"    one area (the types for its offer)
 *   npm run prefill -- --force              refill even what was saved in the last week
 *   npm run prefill -- --web                also use web search to find websites (uses your search quota)
 *   npm run prefill -- --google             also use Google Places (uses your Google quota; refill within 30 days)
 *
 * Businesses already filled in the last week are skipped, so running it again only does what's due.
 * It can take a while (the free map servers allow ~2 requests at a time): leave it running, or stop
 * with Ctrl+C and run it again later; finished areas are kept.
 */
try {
  process.loadEnvFile(".env.local");
} catch {}

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3).replace(/^"|"$/g, "");

async function main() {
  const { VADODARA, prefillPlan, runPrefill } = await import("../lib/prefill");
  const { defaultDeps } = await import("../lib/pipeline");
  const { localDirectory } = await import("../lib/directory");
  const { noStore } = await import("../lib/prefill");

  const offer = opt("offer");
  const only = opt("area");
  const areas = [
    ...(offer !== "logistics" ? VADODARA.website.map((area) => ({ offer: "website_development" as const, area, types: VADODARA.websiteTypes })) : []),
    ...(offer !== "website" ? VADODARA.logistics.map((area) => ({ offer: "logistics" as const, area, types: VADODARA.logisticsTypes })) : []),
  ].filter((a) => !only || a.area.toLowerCase() === only.toLowerCase());
  if (!areas.length) throw new Error(`No area called "${only}". Areas: ${[...VADODARA.website, ...VADODARA.logistics].join(", ")}`);

  const directory = localDirectory();
  const { jobs, skipped } = await prefillPlan({ city: VADODARA.city, areas, directory, force: flag("force") });
  const sources = { osm: true, web: flag("web"), google: flag("google") };
  console.log(`Prefill ${VADODARA.city}: ${jobs.length} search${jobs.length === 1 ? "" : "es"} to run (${areas.length} areas; ${skipped} area × type sets already fresh).`);
  console.log(`Sources: OpenStreetMap${sources.web ? ", web search" : ""}${sources.google ? ", Google Places" : ""}. Websites are looked for at likely addresses${sources.web ? " and by web search" : ""}.`);
  if (flag("dry")) {
    for (const j of jobs) console.log(` - ${j.area} (${j.offer === "logistics" ? "logistics" : "websites"}): ${j.categories.join(", ")}`);
    return;
  }
  if (!jobs.length) return console.log("Nothing to do: everything was filled in the last week. Use --force to refill.");

  const ctrl = new AbortController();
  process.on("SIGINT", () => {
    console.log("\nStopping after the current search… (finished areas are kept)");
    ctrl.abort();
  });
  const started = Date.now();
  const r = await runPrefill({ city: VADODARA.city, jobs, deps: { ...defaultDeps(noStore), directory }, sources, log: (m) => console.log(m), signal: ctrl.signal });
  console.log(`\nDone in ${Math.round((Date.now() - started) / 60_000)} min: ${r.saved} businesses saved to .data/directory${r.failed ? `, ${r.failed} search${r.failed === 1 ? "" : "es"} failed` : ""}.`);
  if (r.failed || r.missed) console.log(`${r.missed ? `${r.missed} business type${r.missed === 1 ? "" : "s"} couldn't be listed because the map servers were busy. ` : ""}Run npm run prefill again later: only what's missing is done again.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
