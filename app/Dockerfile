# Lead Autopilot as one container: the web app, the email worker and PDF reports.
#   docker build -t lead-autopilot .
#   docker run -p 3000:3000 -v lead-data:/app/.data -e APP_PASSWORD=... lead-autopilot
# See DEPLOY.md for hosts (Render, Railway, Fly.io, any VPS).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
# Chromium makes the PDF reports (without it they open as a printable web page instead)
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 PDF_BROWSER=/usr/bin/chromium
RUN useradd --system --uid 1001 --create-home app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# searches, clients, outreach logs and the cache live here: mount a volume so they survive restarts
RUN mkdir -p /app/.data && chown app:app /app/.data
VOLUME ["/app/.data"]
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
