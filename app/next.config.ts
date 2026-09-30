import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["cheerio", "playwright-core", "nodemailer", "imapflow"],
};

export default nextConfig;
