import type { Browser } from "playwright-core";

/**
 * Turns our own report HTML into a PDF with the Chrome or Edge already on this computer (no browser
 * download). Scripts are off and every network request is blocked while it renders, so the page
 * can only show what's in the HTML. One browser is kept open between reports and closed when idle.
 *
 * Set PDF_BROWSER to a Chrome/Edge/Chromium executable if it isn't found on its own.
 */

export class NoBrowserError extends Error {}

const IDLE_MS = 120_000;
const g = globalThis as unknown as { __leadPdf?: { browser?: Promise<Browser>; timer?: ReturnType<typeof setTimeout> } };
const state = (g.__leadPdf ??= {});

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const tries: Array<Record<string, string>> = [
    ...(process.env.PDF_BROWSER ? [{ executablePath: process.env.PDF_BROWSER }] : []),
    { channel: "msedge" }, // comes with every Windows PC
    { channel: "chrome" },
    {},
  ];
  for (const t of tries) {
    try {
      return await chromium.launch({ ...t, headless: true });
    } catch {}
  }
  throw new NoBrowserError("No Chrome or Edge found to make the PDF. Install Chrome, or set PDF_BROWSER to its path in .env.local.");
}

function browser(): Promise<Browser> {
  if (!state.browser) {
    const b = launch();
    state.browser = b;
    b.then((x) => x.on("disconnected", () => state.browser === b && (state.browser = undefined))).catch(() => state.browser === b && (state.browser = undefined));
  }
  return state.browser;
}

function closeWhenIdle() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    const b = state.browser;
    state.browser = undefined;
    b?.then((x) => x.close()).catch(() => {});
  }, IDLE_MS);
  state.timer.unref?.();
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const ctx = await (await browser()).newContext({ javaScriptEnabled: false });
  try {
    const page = await ctx.newPage();
    await page.route("**/*", (r) => r.abort());
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await ctx.close().catch(() => {});
    closeWhenIdle();
  }
}
