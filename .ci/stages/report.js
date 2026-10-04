#!/usr/bin/env node
/**
 * Reports job status to the live relay (optional — no-ops if RELAY_URL isn't set).
 * Called at the start and end of every job in adaptive.yml via a tiny wrapper step.
 *
 * Usage (inside a workflow step):
 *   node .ci/stages/report.js <job> <status> ["<detail>"]
 *
 * status: queued | running | success | failed | skipped
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const RELAY_URL = process.env.RELAY_URL;       // e.g. https://your-relay.fly.dev
const RELAY_SECRET = process.env.RELAY_SECRET; // shared HMAC secret, matches server

if (!RELAY_URL) {
  // Silently no-op — relay is optional. Pipeline works fine without it.
  process.exit(0);
}

const [,, job, status, detail] = process.argv;

const payload = {
  runId: process.env.GITHUB_RUN_ID || `local-${Date.now()}`,
  repo: process.env.GITHUB_REPOSITORY || 'local/repo',
  branch: process.env.GITHUB_REF_NAME || 'local',
  commit: (process.env.GITHUB_SHA || '').slice(0, 7),
  profile: safeParse(process.env.CI_PROFILE),
  runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  job,
  status,
  detail: detail || null,
};

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

const body = JSON.stringify(payload);
const url = new URL('/webhook', RELAY_URL);
const lib = url.protocol === 'https:' ? https : http;

const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
if (RELAY_SECRET) {
  headers['X-Relay-Signature'] = crypto.createHmac('sha256', RELAY_SECRET).update(body).digest('hex');
}

const req = lib.request(url, { method: 'POST', headers }, (res) => {
  res.on('data', () => {});
  res.on('end', () => process.exit(0));
});

req.on('error', (e) => {
  // Never fail the pipeline because the relay is down
  console.warn(`⚠️  Relay unreachable (non-blocking): ${e.message}`);
  process.exit(0);
});

req.write(body);
req.end();
