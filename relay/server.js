#!/usr/bin/env node
/**
 * Adaptive CI/CD — Live Relay
 * ─────────────────────────────────────────────────────────────────
 * Bridges GitHub Actions (which can't be polled directly from a
 * browser due to CORS + auth) to the published dashboard page.
 *
 * Flow:
 *   1. GitHub Actions calls POST /webhook/:runId/:event on every
 *      phase transition (see .ci/stages/report.js).
 *   2. This server keeps the last N runs in memory (optionally
 *      persisted to a JSON file so it survives restarts).
 *   3. The dashboard polls GET /status every few seconds, or opens
 *      GET /stream (Server-Sent Events) for push updates.
 *
 * Deploy this ANYWHERE that gives you a public HTTPS URL:
 *   - Fly.io / Railway / Render free tier (recommended — 2 min setup)
 *   - A VPS behind Caddy/nginx
 *   - Even a Cloudflare Worker (see relay/cloudflare-worker.js variant)
 *
 * No database required. No GitHub token required on the relay side —
 * GitHub pushes to it, the relay never pulls from GitHub.
 * ─────────────────────────────────────────────────────────────────
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 8787;
const WEBHOOK_SECRET = process.env.RELAY_SECRET || ''; // shared secret, set this!
const STATE_FILE = process.env.STATE_FILE || '.relay-state.json';
const MAX_RUNS = 20;
const RUN_TTL_MS = 1000 * 60 * 60 * 6; // forget runs older than 6h

// ─── State ────────────────────────────────────────────────────────

let runs = new Map(); // runId -> run object
let clients = new Set(); // SSE subscribers

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    runs = new Map(raw);
    console.log(`Loaded ${runs.size} runs from ${STATE_FILE}`);
  } catch { /* fresh start */ }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify([...runs.entries()]));
  } catch (e) {
    console.warn('Could not persist state:', e.message);
  }
}

function pruneOldRuns() {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (now - run.updatedAt > RUN_TTL_MS) runs.delete(id);
  }
  // keep only the most recent MAX_RUNS
  if (runs.size > MAX_RUNS) {
    const sorted = [...runs.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    runs = new Map(sorted.slice(0, MAX_RUNS));
  }
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { clients.delete(res); }
  }
}

// ─── Auth ─────────────────────────────────────────────────────────

function verifySignature(req, rawBody) {
  if (!WEBHOOK_SECRET) return true; // no secret configured = open (dev only!)
  const sig = req.headers['x-relay-signature'];
  if (!sig) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

// ─── CORS ─────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // dashboard is a public artifact URL, origin varies
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Signature');
}

// ─── Handlers ─────────────────────────────────────────────────────

function handleWebhook(req, res, body) {
  if (!verifySignature(req, body)) {
    res.writeHead(401).end(JSON.stringify({ error: 'bad signature' }));
    return;
  }

  let event;
  try { event = JSON.parse(body); } catch {
    res.writeHead(400).end(JSON.stringify({ error: 'bad json' }));
    return;
  }

  const { runId, repo, branch, commit, profile, phase, job, status, detail, runUrl } = event;
  if (!runId) {
    res.writeHead(400).end(JSON.stringify({ error: 'runId required' }));
    return;
  }

  const existing = runs.get(runId) || {
    runId, repo, branch, commit, profile, runUrl,
    startedAt: Date.now(),
    jobs: {},
    status: 'running',
  };

  existing.updatedAt = Date.now();
  existing.repo = repo || existing.repo;
  existing.branch = branch || existing.branch;
  existing.commit = commit || existing.commit;
  existing.profile = profile || existing.profile;
  existing.runUrl = runUrl || existing.runUrl;

  if (job) {
    existing.jobs[job] = { phase, status, detail, updatedAt: Date.now() };
  }
  if (status === 'success' || status === 'failed') {
    // top-level pipeline status only set by a final "pipeline" job event
    if (job === 'pipeline') existing.status = status;
  }

  runs.set(runId, existing);
  pruneOldRuns();
  saveState();
  broadcast({ type: 'update', run: existing });

  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
}

function handleStatus(req, res) {
  cors(res);
  const list = [...runs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ runs: list }));
}

function handleStream(req, res) {
  cors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'hello', runs: [...runs.values()] })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ─── Server ───────────────────────────────────────────────────────

loadState();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => handleWebhook(req, res, body));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    return handleStatus(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    return handleStream(req, res);
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200).end('ok');
    return;
  }

  res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`✅ Adaptive CI/CD relay listening on :${PORT}`);
  console.log(`   POST /webhook  — GitHub Actions reports here`);
  console.log(`   GET  /status   — dashboard polls here`);
  console.log(`   GET  /stream   — dashboard can subscribe here (SSE)`);
  if (!WEBHOOK_SECRET) {
    console.warn(`⚠️  RELAY_SECRET not set — webhook endpoint is UNAUTHENTICATED. Set it in production.`);
  }
});
