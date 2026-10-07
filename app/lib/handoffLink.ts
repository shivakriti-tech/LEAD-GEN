import { publicBase, signValue } from "./mail/unsubscribe";

/** The client's private page for one handoff (needs APP_BASE_URL to work outside your computer). */
export async function handoffLink(id: string, env: Record<string, string | undefined> = process.env, key?: string): Promise<string | undefined> {
  const base = publicBase(env) ?? (env.APP_BASE_URL?.trim().replace(/\/+$/, "") || undefined);
  if (!base) return undefined;
  return `${base}/api/handoff/${id}?t=${await signValue("handoff", id, key)}`;
}
