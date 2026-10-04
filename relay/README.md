# Live Dashboard Relay

This is the missing piece that makes the dashboard genuinely **live** instead
of a simulator. It's a ~150-line Node server with no dependencies.

## Why this exists

A published dashboard page runs in a locked-down browser sandbox that can
only make network requests to a handful of script CDNs — it **cannot** call
`api.github.com` directly (no CORS, no auth, blocked by the page's content
security policy). So the dashboard can't pull from GitHub Actions on its own.

Instead: GitHub Actions **pushes** status to this relay as each job runs
(`report.js`, already wired into `adaptive.yml`), and the relay exposes a
plain HTTPS JSON endpoint the dashboard **can** call. You deploy the relay
once; after that, it's invisible plumbing.

```
GitHub Actions job  ──POST /webhook──▶  relay (your URL)  ◀──GET /status── dashboard
```

## Deploy it (pick one, ~2 minutes)

### Option A — Fly.io (recommended, free tier)
```bash
cd relay
fly launch --now        # creates the app from fly.toml and deploys
fly secrets set RELAY_SECRET=$(openssl rand -hex 32)
```
Your relay URL will be `https://<app-name>.fly.dev`.

### Option B — Railway
```bash
cd relay
railway init
railway up
railway variables set RELAY_SECRET=$(openssl rand -hex 32)
```

### Option C — Render
1. Push the `relay/` folder to its own GitHub repo (or a subfolder is fine
   with Render's "root directory" setting).
2. New → Web Service → point at the repo → root dir `relay/`.
3. Add environment variable `RELAY_SECRET` = (a random 32+ char string).
4. Render gives you `https://your-service.onrender.com`.

### Option D — Any VPS / Docker host
```bash
cd relay
docker build -t adaptive-relay .
docker run -d -p 8787:8787 -e RELAY_SECRET=$(openssl rand -hex 32) adaptive-relay
```
Put it behind Caddy/nginx/Cloudflare Tunnel for HTTPS.

## Wire it to your pipeline

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `RELAY_URL` | `https://your-relay-url` (from whichever option above) |
| `RELAY_SECRET` | the same random string you set on the relay |

That's it. `adaptive.yml` already calls `node .ci/stages/report.js <job> <status>`
after every stage — those calls are silent no-ops if `RELAY_URL` isn't set, so
nothing breaks for anyone who skips this.

## Wire it to the dashboard

Open the published dashboard → **Live** tab → paste your relay URL
(`https://your-relay-url`) into the "Relay URL" field → Connect.

The dashboard stores it in its own `localStorage` (per-viewer, never shared)
and starts polling `GET /status` every 4s, or opens `GET /stream` for
instant push updates via Server-Sent Events.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhook` | GitHub Actions reports job status here (HMAC-signed) |
| `GET` | `/status` | Dashboard polls this — returns the last 20 runs as JSON |
| `GET` | `/stream` | Dashboard can subscribe here instead — Server-Sent Events |
| `GET` | `/health` | For your host's health check |

## What it does NOT do

- **No database** — state is in-memory, optionally flushed to a local JSON
  file (`.relay-state.json`) so a restart doesn't lose the last few runs.
  If your host's filesystem is ephemeral (e.g. some serverless platforms),
  state is lost on redeploy/restart — that's fine for a status mirror, not
  meant as a system of record.
- **No GitHub API calls** — the relay never talks to GitHub. GitHub talks
  to it. This means it needs zero GitHub tokens/permissions and can't be
  used to query anything beyond what your pipeline explicitly reports.
- **No auth on `/status`/`/stream`** — these are read-only mirrors of your
  CI status, intended to be low-sensitivity (job names, pass/fail, which
  stages ran). Don't report secrets or sensitive build output through
  `report.js` details — it's designed for status, not logs.
- **Single-tenant** — one relay instance mirrors whichever repos point
  `RELAY_URL` at it. Fine for a personal project or small team; for many
  unrelated repos, consider namespacing by adding a `project` field to the
  webhook payload and filtering client-side.
