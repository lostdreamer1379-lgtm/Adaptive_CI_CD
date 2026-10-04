# Adaptive CI/CD Pipeline

A single, universal GitHub Actions pipeline that **detects your project automatically** and runs only the stages that apply — no per-project YAML editing required.

## How it works

```
push/PR → [Detect] → [Install] → [Lint | Typecheck | Test | Security] → [Build] → [Docker] → [Deploy] → [Notify]
             │
             └─ node .ci/detect.js scans the repo and emits a JSON profile
                every other job reads from, via needs.detect.outputs.*
```

`detect.js` inspects your repo (package.json deps, lockfiles, config files, folder
structure) and figures out:

| Detected | How |
|---|---|
| Project type (React/Next/Vue/Python/Go/...) | `package.json` dependencies, or `pyproject.toml` / `go.mod` |
| Package manager | which lockfile exists (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm) |
| Test framework | `vitest`/`jest`/`playwright`/`cypress`/`pytest` in deps |
| Linter/formatter | `eslint`/`biome`/`prettier` in deps |
| TypeScript | `tsconfig.json` present |
| Docker | `Dockerfile` present |
| Deploy target | `vercel.json`, `netlify.toml`, `fly.toml`, `railway.toml`, `render.yaml`, `Dockerfile`, k8s manifests |
| Monorepo | `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, or `workspaces` in package.json |
| Coverage threshold | parsed from vitest/jest config, defaults to 80% |

Every job in the workflow then runs `if: needs.detect.outputs.hasX == 'true'` —
jobs that don't apply to your stack are **skipped entirely**, not just silently no-op'd.

## File structure

```
.ci/
├── detect.js           ← the intelligence engine (run this first, always)
├── affected.js         ← for monorepos: finds which packages changed
└── stages/
    ├── lint.js          ← adapts: eslint / biome / ruff / golangci-lint / clippy
    ├── test.js          ← adapts: vitest / jest / playwright / pytest / go test
    ├── build.js         ← adapts: vite / next / tsc / go build / cargo build
    ├── security.js      ← adapts: npm audit / snyk / safety / bandit / govulncheck
    ├── deploy.js        ← adapts: vercel / netlify / fly / railway / k8s / aws
    ├── notify.js        ← sends Slack/Discord webhook on completion
    └── report.js        ← reports job status to the live relay (optional)

.github/workflows/
└── adaptive.yml         ← the single universal workflow — never needs editing

relay/                   ← optional: makes the dashboard's Live tab real
├── server.js             ← ~150-line Node server, zero dependencies
├── Dockerfile / fly.toml ← one-command deploy to Fly.io or any Docker host
└── README.md             ← 2-minute setup guide

dashboard.html           ← publishable Artifact — Live / Simulate / Files / Docs tabs
```

## Quick start

```bash
# 1. Copy into your project
cp -r .ci your-project/
cp -r .github your-project/

# 2. Make stage scripts executable (optional, CI runs them via `node`)
chmod +x your-project/.ci/stages/*.js

# 3. Preview what it will detect, locally, before pushing
cd your-project
node .ci/detect.js

# 4. Commit and push — the pipeline adapts on its own
git add .ci .github
git commit -m "chore: add adaptive CI/CD pipeline"
git push
```

No YAML editing. No per-project config file. Add a `Dockerfile` later and the
pipeline starts building/pushing images on its own, next push.

## Required secrets (only add what you use)

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Needed for |
|---|---|
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | Vercel deploys |
| `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID` | Netlify deploys |
| `FLY_API_TOKEN` | Fly.io deploys |
| `RAILWAY_TOKEN` | Railway deploys |
| `RENDER_API_KEY`, `RENDER_SERVICE_ID` | Render deploys |
| `SLACK_WEBHOOK` | Slack notifications |
| `DISCORD_WEBHOOK` | Discord notifications |
| `SNYK_TOKEN` | Snyk security scanning (optional — falls back to `npm audit`) |

`GITHUB_TOKEN` (for GHCR Docker pushes) is provided automatically by Actions.

## Deploy rules

- Pushes to `main`/`master` → full pipeline + deploy
- Any other branch / PR → full pipeline, **no deploy** (build-and-verify only)
- `workflow_dispatch` with `force_deploy: true` → deploy from any branch manually

## What it can and can't do

See [`CAPABILITIES.md`](./CAPABILITIES.md) for the full breakdown — every supported
framework/deploy target, and 20 documented limitations (non-standard layouts, no
blue-green/canary deploys, no live-connected dashboard, no DB service containers in
tests, monorepo detection is file-diff-based rather than dependency-graph-aware, etc.).
Read it before relying on this in a complex or regulated environment.

## Extending it

To support a new framework or deploy target, add one `case` branch to the
relevant `.ci/stages/*.js` file and one detection rule to `detect.js`. The
workflow YAML itself never needs to change — that's the point.

```js
// .ci/detect.js
if (deps['remix']) return 'remix';   // ← add a new type

// .ci/stages/deploy.js
case 'cloudflare-pages':             // ← add a new deploy target
  run('npx wrangler pages deploy dist');
  break;
```

## Live dashboard (optional)

`dashboard.html` has a **Live** tab that shows real status from your actual
GitHub Actions runs — not a simulation. Because a published dashboard page
can't call `api.github.com` directly (browser sandbox restrictions), it needs
a tiny relay in between: GitHub pushes status to the relay, the dashboard
pulls from the relay.

```
GitHub Actions ──POST /webhook──▶ relay (you deploy, ~2 min) ◀──GET /status── dashboard
```

1. Deploy `relay/` (Fly.io/Railway/Render — see `relay/README.md`)
2. Add `RELAY_URL` + `RELAY_SECRET` as GitHub Actions secrets
3. Paste the relay URL into the dashboard's Live tab

Skip all of this and the pipeline still works exactly the same — `report.js`
calls are silent no-ops when `RELAY_URL` isn't set, and the dashboard's
Simulate tab works standalone with no backend at all.

## Monorepo support

If `detectMonorepo()` finds a workspace config, run `.ci/affected.js` in a
matrix job to test/build only the packages that changed in the current diff —
full instructions and example matrix wiring are in `affected.js` comments.
