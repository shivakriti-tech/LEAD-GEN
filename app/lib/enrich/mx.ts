import { resolveMx } from "node:dns/promises";

const mxSeen = new Map<string, Promise<boolean | undefined>>();
/** Does this domain accept mail? true/false, or undefined when DNS didn't answer. */
export function domainAcceptsMail(domain: string): Promise<boolean | undefined> {
  const d = domain.toLowerCase();
  let p = mxSeen.get(d);
  if (!p) {
    p = Promise.race([
      resolveMx(d).then(
        (mx) => mx.some((m) => m.exchange && m.exchange !== "."), // "." = null MX: accepts no mail
        (e: NodeJS.ErrnoException) => (e.code === "ENOTFOUND" || e.code === "ENODATA" ? false : undefined),
      ),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 4000)),
    ]);
    mxSeen.set(d, p);
  }
  return p;
}
