import { NextResponse, type NextRequest } from "next/server";
import { gate, newGateState, type GateState } from "./lib/security";

/**
 * Every request passes through here first (see lib/security.ts for the rules):
 * password (APP_PASSWORD; the browser asks, any user name), wrong-password lockout, requests from
 * other sites refused, per-address rate limits and request size limits.
 * The WhatsApp webhook (called by Meta) and the unsubscribe link (opened by email recipients) need
 * no password: they check their own signature or signed token, and are only rate limited.
 */
const g = globalThis as unknown as { __leadGate?: GateState };
const state = (g.__leadGate ??= newGateState());

export function proxy(req: NextRequest) {
  const r = gate(req, state);
  if (r.ok) return NextResponse.next();
  return new NextResponse(r.message, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...r.headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
