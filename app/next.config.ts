import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security";

const nextConfig: NextConfig = {
  serverExternalPackages: ["cheerio", "playwright-core", "nodemailer", "imapflow"],
  poweredByHeader: false,
  // a self-contained server for Docker (Dockerfile): only the files the app needs
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // saved data, tests and tools never go into the server bundle
  outputFileTracingExcludes: { "/*": ["./.data/**/*"] },
  // the PDF report loads playwright-core's own data files at run time, which tracing can't see
  outputFileTracingIncludes: { "/api/searches/**": ["./node_modules/playwright-core/**/*"] },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default nextConfig;
