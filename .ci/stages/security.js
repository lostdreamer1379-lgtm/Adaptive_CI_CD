#!/usr/bin/env node
/**
 * Adaptive Security Stage
 * Scans for vulnerabilities using the best tool available for the stack.
 */
const { execSync } = require('child_process');
const profile = JSON.parse(process.env.CI_PROFILE || '{}');

function run(cmd, allowFail = false) {
  console.log(`\n▶ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (e) {
    if (!allowFail) throw e;
    console.warn(`⚠️  Command failed (non-blocking): ${cmd}`);
  }
}

function security() {
  const { language, securityTools } = profile;

  console.log(`\n🛡️  Running security audit for: ${language}\n`);

  if (language === 'python') {
    run('pip install safety bandit', true);
    run('safety check', true);
    run('bandit -r . -x .venv,tests', true);
    return;
  }

  if (language === 'go') {
    run('go install golang.org/x/vuln/cmd/govulncheck@latest', true);
    run('govulncheck ./...', true);
    return;
  }

  if (language === 'rust') {
    run('cargo audit', true);
    return;
  }

  // JavaScript / TypeScript
  if (securityTools?.includes('snyk') && process.env.SNYK_TOKEN) {
    run('npx snyk test --severity-threshold=high');
  } else {
    // npm audit — exit 0 even on findings so pipeline isn't blocked, just warned
    run('npm audit --audit-level=critical', true);
  }

  // Check for secrets accidentally committed
  if (execSync('which gitleaks 2>/dev/null', { encoding: 'utf8' }).trim()) {
    run('gitleaks detect --source . --no-git', true);
  }
}

security();
