#!/usr/bin/env node
/**
 * Adaptive Notify Stage
 * Sends pipeline result to Slack and/or Discord based on detected config.
 */
const https = require('https');
const profile = JSON.parse(process.env.CI_PROFILE || '{}');

const status   = process.env.PIPELINE_STATUS || 'unknown';
const build    = process.env.BUILD_STATUS    || 'unknown';
const repo     = process.env.REPO            || 'unknown/repo';
const branch   = process.env.BRANCH          || 'unknown';
const commit   = (process.env.COMMIT         || '').slice(0, 7);
const runUrl   = process.env.RUN_URL         || '#';
const target   = profile.deployTarget        || 'none';

const isSuccess = status === 'success';
const emoji     = isSuccess ? '✅' : '❌';
const color     = isSuccess ? '#22c55e' : '#ef4444';

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(raw));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function notify() {
  const message = `${emoji} *${repo}* — Pipeline ${status.toUpperCase()}`;
  const details = `Branch: \`${branch}\` · Commit: \`${commit}\` · Deploy: \`${target}\``;

  // Slack
  if (process.env.SLACK_WEBHOOK) {
    console.log('📣 Notifying Slack...');
    await post(process.env.SLACK_WEBHOOK, {
      attachments: [{
        color,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: message } },
          { type: 'section', text: { type: 'mrkdwn', text: details } },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Run' }, url: runUrl }] },
        ],
      }],
    });
    console.log('✅ Slack notified');
  }

  // Discord
  if (process.env.DISCORD_WEBHOOK) {
    console.log('📣 Notifying Discord...');
    await post(process.env.DISCORD_WEBHOOK + '/slack', {
      attachments: [{
        color: isSuccess ? 0x22c55e : 0xef4444,
        title: message,
        description: `${details}\n[View Run](${runUrl})`,
      }],
    });
    console.log('✅ Discord notified');
  }

  if (!process.env.SLACK_WEBHOOK && !process.env.DISCORD_WEBHOOK) {
    console.log('ℹ️  No notification webhooks configured (SLACK_WEBHOOK / DISCORD_WEBHOOK).');
  }
}

notify().catch(e => { console.error('Notification failed:', e); process.exit(0); });
