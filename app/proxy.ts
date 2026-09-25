import { NextResponse, type NextRequest } from "next/server";

/**
 * Password protection. Saved searches hold business phone numbers and emails, and every
 * search spends your API quota, so a live app must not be open to anyone with the link.
 * Set APP_PASSWORD in .env.local (or your host's settings) and the browser asks for it;
 * any user name works. Without APP_PASSWORD the app stays open, which is fine on your own computer.
 */
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    let given = "";
    try {
      const decoded = atob(header.slice(6));
      given = decoded.slice(decoded.indexOf(":") + 1);
    } catch {}
    if (sameText(given, password)) return NextResponse.next();
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Lead Autopilot", charset="UTF-8"' },
  });
}

/** Compare without stopping at the first different character, so timing doesn't leak the password. */
function sameText(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
