import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fetchWithTimeout } from "./util";
import { liveBuild } from "./security";

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
      (a === 192 && b === 88 && Number(ip.split(".")[2]) === 99) || // 6to4 relay
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && Number(ip.split(".")[2]) === 100) || // documentation
      (a === 203 && b === 0 && Number(ip.split(".")[2]) === 113) || // documentation
      a >= 224 // multicast, reserved, broadcast
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    // an IPv4 address inside IPv6: mapped (::ffff:), compatible (::), NAT64 (64:ff9b::), written as dots or hex
    const v4 = s.match(/^(?:::ffff:|::|64:ff9b::)(?:0:)?(\d+\.\d+\.\d+\.\d+)$/)?.[1] ?? hexV4(s.match(/^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/));
    if (v4) return isPrivateIp(v4);
    // 6to4 (2002:AABB:CCDD::) carries an IPv4 address in its second and third groups
    const six = s.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
    if (six) return isPrivateIp(hexV4(six)!);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff") || s.startsWith("2001:db8:") || s.startsWith("100::");
  }
  return false;
}

/** Two hex groups (from a regex match's groups 1 and 2) as a dotted IPv4 address. */
function hexV4(m: RegExpMatchArray | null): string | undefined {
  if (!m) return undefined;
  const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

const blockPrivate = () => liveBuild();

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
