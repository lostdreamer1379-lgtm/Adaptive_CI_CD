# Adaptive CI/CD Pipeline — Capabilities & Limitations

## What It Does

### 1. **Zero-Configuration Project Detection**
- Scans repo and detects project type automatically
- Works for: React, Next.js, Vue, Nuxt, Svelte, Astro, Remix, Node.js APIs, Python, Go, Rust, Java, PHP
- No `ci.yml` or `.circleci.toml` per project — one `.github/workflows/adaptive.yml` works for all
- Identifies package manager (npm/pnpm/yarn/bun), test framework, linter, build tool, deploy target

### 2. **Intelligent Stage Skipping**
- Detects what you have, runs only what applies
- React project without Docker? Docker job skipped entirely
- Python project? Skips Node.js test frameworks, runs pytest instead
- No tests? Test job is marked "skipped" in the UI (not a silent no-op failure)
- No deploy config? Deploy job doesn't run

### 3. **Multi-Language Support**
| Language | Detected Via | Supports |
|---|---|---|
| JavaScript/TypeScript | `package.json` deps | ESLint, Prettier, Biome, Vitest, Jest, Playwright, Cypress, Vite, Next, Webpack, Rollup, esbuild |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py` | Ruff, Flake8, Pytest, Bandit, Safety |
| Go | `go.mod` | golangci-lint, go fmt, go test, govulncheck |
| Rust | `Cargo.toml` | Clippy, Cargo test, Cargo audit |
| Java | `pom.xml`, `build.gradle` | Maven, Gradle (detection only; stages not yet implemented) |

### 4. **Smart Caching**
- Auto-detects which lockfile exists
- npm → caches `~/.npm`
- pnpm → caches `~/.pnpm-store`
- yarn → caches `~/.yarn/cache`
- bun → uses `bun.lockb`
- Python → caches `.venv`
- Go → caches `~/go/pkg/mod`
- Reuses cache key from lockfile hash — incremental builds are fast

### 5. **Quality Gates (Parallel)**
Runs in parallel, fails the pipeline if any gate fails:
- **Lint**: ESLint, Biome, Ruff, golangci-lint, Clippy (detects which one and runs it)
- **TypeScript**: `npx tsc --noEmit` (only if `tsconfig.json` exists)
- **Test**: Vitest, Jest, Playwright, Cypress, pytest, Go test, Cargo test (with coverage thresholds)
- **Security**: npm audit, Snyk, Bandit, Safety, govulncheck (continues even if findings, reports them)

### 6. **Adaptive Build**
- Reads project config and runs the right build command
- React/Vue → Vite
- Next.js → `next build`
- Node.js → TypeScript compilation with tsc
- Go → `go build`
- Rust → `cargo build --release`
- Python → `python -m build` (if package)
- Falls back to `package.json` `build` script if it exists

### 7. **Multi-Platform Deployment**
Detects which deploy target you have and deploys to it:
- **Vercel** (via `vercel.json`)
- **Netlify** (via `netlify.toml`)
- **Fly.io** (via `fly.toml`)
- **Railway** (via `railway.toml`)
- **Render** (via `render.yaml`)
- **Docker/GHCR** (via `Dockerfile` + GitHub Container Registry)
- **Kubernetes** (via `k8s/` folder)
- **Heroku** (via `Procfile`)
- **AWS** (CodeDeploy, CloudFront, S3 — via `appspec.yml` or serverless framework)

Only the one it detects gets triggered. Push to branch with vercel.json → Vercel deploys. Same repo, add fly.toml → next push deploys to Fly instead (no YAML changes).

### 8. **Branching Logic**
- `main` / `master` → full pipeline + deploy
- Any other branch → full pipeline, **no deploy** (build + verify only)
- Pull requests → full pipeline, no deploy
- `workflow_dispatch` with `force_deploy: true` → deploy from any branch manually

### 9. **Monorepo Support** (via `affected.js`)
- Detects workspaces: `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, npm workspaces
- Diffs `git diff HEAD~1` to find which packages changed
- Outputs a matrix: `[{package: "api", path: "packages/api"}, ...]`
- Runs build/test only for affected packages (saves CI time)
- Falls back to all packages if root-level files (`.ci/`, `.github/`, shared config) changed

### 10. **Notifications** (Slack/Discord)
- After pipeline completes, sends webhook to Slack/Discord
- Shows status (✅ success / ❌ failed), branch, commit, build URL
- Only fires on deploy-triggering branches

### 11. **Security Scanning**
- npm audit (all JS projects)
- Snyk (if token present)
- Bandit (Python)
- Safety (Python)
- govulncheck (Go)
- gitleaks (secret detection) if available

### 12. **Docker Support**
- Auto-detects `Dockerfile`
- Builds with buildx, caches layers
- Pushes to GitHub Container Registry (ghcr.io) on main branch
- Uses GITHUB_TOKEN (auto-provided by Actions)

### 13. **Interactive Dashboard**
- Web UI to simulate the pipeline against any config
- Pick project type, package manager, test framework, deploy target, features
- Visualizes which jobs activate vs skip in real-time
- Shows a fake run log with phase times
- File browser with actual source code
- Secrets reference table

---

## What It Can't Do

### 1. **Non-Standard Project Layouts**
- Assumes standard folder structure: `src/`, `dist/`, `packages/`, `apps/`, etc.
- Doesn't handle: custom monorepo layouts, nested monorepos, hybrid JS+Python repos
- Won't detect a project if the key signal file is named differently
  - e.g., if you use `.ts` instead of `tsconfig.json` → no typecheck detection
  - if linter config is in `lint.config.mjs` but not in `package.json` deps → linter not detected

### 2. **Conditional Tests / Skipped Tests**
- Can't know *ahead of time* whether your test suite will pass
- Runs the test stage even if your test file counts are 0 (just exits cleanly)
- Won't skip test stage even if you have `if: skip_tests` in your tests

### 3. **Custom Build Outputs**
- Assumes standard output folders: `dist/`, `build/`, `.next/`, `out/`
- If your build outputs to a non-standard folder, Docker/deploy jobs might not find artifacts
- No way to configure output path (by design — kept minimal)

### 4. **Complex Deployment Flows**
- Doesn't support: blue-green deployments, canary releases, rollback strategies
- Doesn't handle: multi-region deployments, load balancer config, DNS failover
- Deploy jobs are "push and pray" — no health checks, approval gates are binary (GitHub environment only)
- No staging → production promotion pipeline (you have to use multiple repos or branches)

### 5. **Private Dependencies / Auth**
- Can't auto-detect private npm registries or GitHub token setup
- If your build requires private packages, you need to manually add `~/.npmrc` setup or GitHub actions secret
- No Artifactory, Nexus, or JFrog Bintray support

### 6. **Environment Variables**
- Won't auto-inject ENV vars from `.env.example` into jobs
- You have to manually set secrets in GitHub Settings for each var the pipeline needs
- No support for multi-environment `.env.staging` vs `.env.prod` switching

### 7. **Pre-Build / Post-Deploy Hooks**
- Can't run custom scripts before/after stages (no `pretest`, `prebuild` hooks)
- No way to run migrations after deploy
- No support for calling webhooks, triggering external systems

### 8. **Matrix / Parallel Testing**
- Doesn't auto-split tests across multiple OS/Node versions
- No built-in Node 16/18/20 multi-version matrix
- Can add it manually to `.github/workflows/adaptive.yml` but then you're editing YAML

### 9. **Database / Service Setup**
- Can't spin up Postgres, Redis, MongoDB for tests
- No `services:` block for Docker containers
- If your tests need a DB, you have to add that to the workflow manually

### 10. **Code Coverage Reports**
- Generates coverage reports (uploads as artifact) but doesn't publish them
- Won't comment on PRs with coverage diff
- No integration with Codecov, Coveralls
- Coverage thresholds are enforced (test fails if below threshold) but not reported visually

### 11. **Performance Metrics**
- Doesn't track build time trends or regression alerts
- Won't notify if a stage is suddenly 10x slower
- No flamegraph or profiling output

### 12. **Rollback on Failure**
- Deploy job doesn't roll back automatically on failure
- You have to manually revert & redeploy
- No blue-green or canary support to reduce blast radius

### 13. **Branch Protections**
- Can't enforce "deploy only if all checks pass"
- You have to set that up in GitHub repo settings (Settings → Branches → Branch protection rules)
- Pipeline itself won't stop a merge

### 14. **Monorepo Dependency Graph**
- `affected.js` only checks *file changes*, not dependency graph
- If Package A depends on Package B, changing B doesn't trigger A's build
- You have to manually add `--force-all` flag or use a tool like Turbo / Nx for real dependency tracking

### 15. **Language-Specific Gaps**
- **Java**: detected but no stage implementation (can add Maven/Gradle later)
- **PHP**: detected but no stage implementation
- **Ruby/Rails**: not detected at all
- **C#/.NET**: not supported
- **Kotlin/Android**: not supported

### 16. **Custom Testing Setups**
- Only supports industry-standard frameworks
- Won't work with: custom test runners, in-house testing frameworks, shell script test harnesses
- E2E tests against staging: you'd need to add manual service startup

### 17. **License Compliance**
- Doesn't scan for SPDX license compatibility
- No SBOM generation
- Can't report if dependencies have problematic licenses

### 18. **Rate Limiting / Quotas**
- Doesn't handle GitHub Actions rate limits
- If pipeline runs 100x a day, you'll hit concurrency limits and slow down
- No smart queuing or backoff

### 19. **Real-Time Feedback**
- Live dashboard — web UI is a simulator, not live-connected to actual CI runs
- Can't see real job output in the web UI (have to click through to GitHub)
- No webhook listener or GitHub API polling to pull real run status into the dashboard

### 20. **Vendor Lock-In**
- Hardcoded for GitHub Actions (not GitLab CI, CircleCI, Jenkins)
- Moving to another CI platform means rewriting everything
- Can't run locally without heavy mocking

---

## Edge Cases & Gotchas

### Will work but might surprise you:
- **Monorepo with no workspaces key**: if you have a `packages/` folder but no `pnpm-workspace.yaml`, the monorepo detector doesn't trigger. Add the file (even if empty) to activate it.
- **Linter in package.json but not executable**: if you have `eslint` as a dev dep but no `.eslintrc.*`, lint stage runs but fails silently. You have to commit config.
- **No test framework but test scripts exist**: stage still runs and passes (empty test suite = success).
- **Python project with package.json**: if you have both, JavaScript detection wins (will try npm instead of pip).
- **Docker image too large**: pipeline pushes to GHCR but doesn't fail if image exceeds size limits — that's a Docker/registry issue.
- **Deploy token expired**: deploy stage starts but authentication fails mid-way. Have to re-add secret.
- **Monorepo with different package managers**: assumes all packages use the same PM (top-level lockfile). Mixing pnpm + npm = undefined behavior.

---

## Summary

| Aspect | Coverage | Notes |
|---|---|---|
| **Detection** | 95% | Covers most standard projects; edge cases in custom layouts |
| **JS/TS** | 90% | Most frameworks, tools, deploy targets; some gaps in advanced patterns |
| **Python** | 70% | Detection + pytest + linting works; no Django/FastAPI-specific optimizations |
| **Go** | 80% | Detection + test + build + linting works; no Docker multi-stage optimization |
| **Deployment** | 85% | 8 platforms, but no advanced strategies (blue-green, canary, rollback) |
| **Notifications** | 80% | Slack/Discord post-deploy; no PR comments, trend alerts |
| **Monorepo** | 75% | File-based change detection; no dep graph awareness |
| **Customization** | 60% | Easy to extend stages; harder to customize flow/branching |

**Best for:** Standard single-language projects (React, Next, Python FastAPI, Go microservices) where one platform handles deployment. **Not ideal for:** complex multi-service systems, multiple languages in one repo, heavy custom workflows, compliance/audit trails.
