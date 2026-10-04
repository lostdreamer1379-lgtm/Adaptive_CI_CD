#!/usr/bin/env node
/**
 * Adaptive Lint Stage
 * Reads CI_PROFILE and runs the right linter for the detected stack.
 */
const { execSync } = require('child_process');
const profile = JSON.parse(process.env.CI_PROFILE || '{}');

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function lint() {
  const { linter, formatter, type, language } = profile;

  // Python
  if (language === 'python') {
    try { run('ruff check .'); } catch { run('flake8 .'); }
    return;
  }

  // Go
  if (language === 'go') {
    run('gofmt -l . && golangci-lint run');
    return;
  }

  // Rust
  if (language === 'rust') {
    run('cargo clippy -- -D warnings');
    return;
  }

  // JavaScript / TypeScript
  switch (linter) {
    case 'biome':
      run('npx biome check --apply .');
      break;
    case 'eslint':
      const ext = profile.isTypescript ? '--ext .ts,.tsx,.js,.jsx' : '--ext .js,.jsx';
      run(`npx eslint . ${ext} --max-warnings=0`);
      if (formatter === 'prettier') {
        run('npx prettier --check .');
      }
      break;
    case 'xo':
      run('npx xo');
      break;
    default:
      console.log('⚠️  No linter detected — skipping lint stage.');
  }
}

lint();
