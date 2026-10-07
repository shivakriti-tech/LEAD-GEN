# Putting Lead Autopilot online

The app runs as one Docker container: the web app, the email sending worker and the PDF reports.
It keeps its data in `/app/.data` (or in Supabase), so give it a **persistent disk** or set up Supabase.

## Before you go online (checklist)

| Setting | Why |
|---|---|
| `APP_PASSWORD` (**required**, 12+ characters) | Without it a live app refuses to open (503). Saved searches hold phone numbers and emails, and every search spends your API quota. Ten wrong passwords lock that address out for 15 minutes. |
| `APP_BASE_URL=https://your-address` | Signed one-click unsubscribe links in emails; also lets requests from that address through the cross-site check behind a proxy. |
| `CRAWLER_CONTACT` | Your real email. OpenStreetMap blocks requests without one. |
| `UNSUBSCRIBE_SECRET` | Any long random text. Keeps unsubscribe links valid across restarts and new servers (Render generates it). |
| A disk at `/app/.data`, or `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Without either, searches disappear when the container restarts. |
| `FEEDBACK_EMAIL` (optional) | Shows a **Feedback** button in the header that emails you with the screen they were on. Good for beta testers. |
| `TRUST_PROXY_HOPS` (default 1) | How many proxies sit in front of the app. If everyone gets "Too many requests" at the same moment, the app is seeing the proxy's address: raise it to 2. |
| Keys | `GOOGLE_PLACES_API_KEY`, `SERPER_API_KEY`, `GEMINI_API_KEY`… as in the README. Set a budget alert on Google Cloud. |

**One deployment per customer.** All logins share one workspace (searches, clients, outreach). To give the app to several customers for feedback, deploy it once per customer, each with its own password and disk (or Supabase project), so nobody sees anyone else's leads.

Things the live build does by itself: the Google Maps scraper is off, private and internal addresses are never fetched (even through redirects), security headers are set (no framing, no sniffing, no referrer, a content security policy), and changes must come from the app's own pages.

## Option A: Render (easiest, from GitHub)

1. Push this repo to GitHub.
2. On https://dashboard.render.com: **New → Blueprint**, pick the repo. Render reads `render.yaml` at the repo root.
3. Fill in the values it asks for (`APP_PASSWORD`, `APP_BASE_URL` can be filled after the first deploy, keys you have).
4. **Apply**. The first build takes 5–8 minutes. The service gets an address like `https://lead-autopilot.onrender.com`.
5. Set `APP_BASE_URL` to that address (Environment tab) and save: it redeploys.

The blueprint uses the `1c-2g` plan in Singapore with a 1 GB disk (disks need a paid plan). Change `region` in `render.yaml` if your customers are elsewhere (`frankfurt`, `oregon`, `ohio`, `virginia`).

## Option B: Railway

1. https://railway.app → **New Project → Deploy from GitHub repo**.
2. Service settings: **Root Directory** `app`. Railway finds the `Dockerfile`.
3. **Variables**: the checklist above.
4. **Volumes**: add one mounted at `/app/.data`.
5. **Networking → Generate Domain**, then set `APP_BASE_URL` to it.

## Option C: any server with Docker (DigitalOcean, Hetzner, AWS Lightsail, a VPS in India…)

```bash
cd app
docker build -t lead-autopilot .
docker run -d --name lead-autopilot --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v lead-data:/app/.data \
  -e APP_PASSWORD='a-long-password-here' \
  -e APP_BASE_URL='https://leads.yourdomain.com' \
  -e CRAWLER_CONTACT='you@yourdomain.com' \
  -e UNSUBSCRIBE_SECRET="$(openssl rand -hex 32)" \
  --env-file .env.production \
  lead-autopilot
```

Put HTTPS in front of it, for example with Caddy (`/etc/caddy/Caddyfile`):

```
leads.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
```

Keep port 3000 bound to `127.0.0.1` as above, so the only way in is through HTTPS.

## Why not Vercel or Netlify?

Searches stream for up to 5 minutes, emails are sent by a background worker that runs all day, and data is kept on disk. Serverless hosts stop all three. Use a host that runs a normal, always-on container (A, B or C).

## After deploying: 5-minute check

1. `https://your-address/api/health` shows `{"ok":true}` (no password needed; it says nothing else).
2. Open the app: the browser asks for the password (any user name).
3. Run a small search (one business type, one area). Leads appear while it runs.
4. Export CSV, and open **Report** (PDF).
5. Setup panel: the sources you expect are green.
6. Email: Outreach → Email shows your mailboxes and their domain records (SPF, DKIM, DMARC).
7. WhatsApp: point the Meta webhook at `https://your-address/api/whatsapp/webhook`.

## Updating

Push to GitHub: Render and Railway rebuild and redeploy by themselves. On a VPS: `git pull`, `docker build`, then `docker rm -f lead-autopilot` and the same `docker run` (the volume keeps the data).

## Backups

With a disk: copy `/app/.data` now and then (`docker cp lead-autopilot:/app/.data ./backup-$(date +%F)`, or Render's disk snapshots). With Supabase: its daily backups.
