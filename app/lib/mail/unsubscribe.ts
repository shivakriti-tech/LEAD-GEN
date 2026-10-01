import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * One-click unsubscribe (RFC 8058), the way Gmail and Yahoo want it: every email carries
 *   List-Unsubscribe: <https://your-app/api/unsubscribe?e=…&t=…>, <mailto:you@…?subject=unsubscribe>
 *   List-Unsubscribe-Post: List-Unsubscribe=One-Click
 * Gmail shows its own "Unsubscribe" button; a click posts to the link and that address is never
 * emailed again. A sender that makes leaving easy is trusted more, and people unsubscribe instead
 * of pressing "Report spam".
 *
 * The link needs the app reachable on the internet: set APP_BASE_URL (https://…). Without it the
 * header has the mailto only, which works too (the inbox scan reads those).
 * Links are signed (HMAC), so nobody can unsubscribe other people's addresses.
 */

let cached: string | undefined;
async function secret(): Promise<string> {
  if (process.env.UNSUBSCRIBE_SECRET?.trim()) return process.env.UNSUBSCRIBE_SECRET.trim();
  if (cached) return cached;
  const file = path.join(process.cwd(), ".data", "unsubscribe-secret");
  try {
    cached = (await fs.readFile(file, "utf8")).trim();
  } catch {
    cached = randomBytes(32).toString("hex");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, cached, { mode: 0o600 });
  }
  return cached;
}

const sign = (key: string, email: string) => createHmac("sha256", key).update(email.toLowerCase()).digest("base64url").slice(0, 32);

export async function unsubscribeToken(email: string, key?: string): Promise<string> {
  return sign(key ?? (await secret()), email);
}
export async function tokenOk(email: string, token: string, key?: string): Promise<boolean> {
  const want = Buffer.from(sign(key ?? (await secret()), email));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A public https address for the app, or undefined (localhost can't be reached by Gmail). */
export function publicBase(env: Record<string, string | undefined> = process.env): string | undefined {
  const b = env.APP_BASE_URL?.trim().replace(/\/+$/, "");
  return b && /^https:\/\//i.test(b) && !/localhost|127\.0\.0\.1/.test(b) ? b : undefined;
}

/** The List-Unsubscribe headers for one email. */
export async function unsubscribeHeaders(to: string, mailbox: string, env: Record<string, string | undefined> = process.env, key?: string): Promise<Record<string, string>> {
  const mailto = `<mailto:${mailbox}?subject=unsubscribe>`;
  const base = publicBase(env);
  if (!base) return { "List-Unsubscribe": mailto };
  const url = `${base}/api/unsubscribe?e=${encodeURIComponent(to.toLowerCase())}&t=${await unsubscribeToken(to, key)}`;
  return { "List-Unsubscribe": `<${url}>, ${mailto}`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
