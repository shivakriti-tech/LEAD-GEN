import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fetchWithTimeout } from "./util";

/**
 * Business websites come from map data, search results and Instagram bios, so anyone can
 * put any address there. In a live build we never load private or internal addresses
 * (localhost, 10.x, 192.168.x, cloud metadata 169.254.169.254, …), including via redirects.
 * On your own computer (npm run dev, tests) everything is allowed.
 */

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast, reserved, broadcast
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return false;
}

const blockPrivate = (env: Record<string, string | undefined> = process.env) => env.NODE_ENV === "production" || !!env.VERCEL || !!env.RENDER;

/** Throws if the URL isn't plain http(s) to a public address. */
export async function assertPublicUrl(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https addresses are checked");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Private address, not checked");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(isPrivateIp)) throw new Error("Private address, not checked");
}

/**
 * fetchWithTimeout for addresses we don't control. In a live build it follows redirects itself
 * (up to 5) so each hop can be checked; `res.url` is the final address either way.
 */
export async function fetchPublic(url: string, init: RequestInit = {}, ms = 10_000): Promise<Response> {
  if (!blockPrivate()) return fetchWithTimeout(url, { ...init, redirect: "follow" }, ms);
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetchWithTimeout(current, { ...init, redirect: "manual" }, ms);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.url) Object.defineProperty(res, "url", { value: current });
    return res;
  }
  throw new Error("Too many redirects");
}
