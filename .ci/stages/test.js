#!/usr/bin/env node
/**
 * Adaptive Test Stage
 * Reads CI_PROFILE and runs the right test framework with coverage.
 */
const { execSync } = require('child_process');
const profile = JSON.parse(process.env.CI_PROFILE || '{}');

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function test() {
  const { testFramework, language, coverageThreshold = 80, packageManager } = profile;
  const pm = packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npx';

  if (language === 'python') {
    run(`pytest --cov=. --cov-fail-under=${coverageThreshold} --cov-report=xml -v`);
    return;
  }

  if (language === 'go') {
    run('go test ./... -coverprofile=coverage.out -v');
    run(`go tool cover -func=coverage.out | tail -1 | awk '{if ($3+0 < ${coverageThreshold}) exit 1}'`);
    return;
  }

  if (language === 'rust') {
    run('cargo test --all');
    return;
  }

  // JavaScript / TypeScript
  switch (testFramework) {
    case 'vitest':
      run(`${pm} vitest run --coverage --coverage.thresholds.lines=${coverageThreshold}`);
      break;

    case 'jest':
      run(`${pm} jest --coverage --coverageThreshold='{"global":{"lines":${coverageThreshold}}}'`);
      break;

    case 'playwright':
      run(`${pm} playwright install --with-deps`);
      run(`${pm} playwright test`);
      break;

    case 'cypress':
      // Cypress needs a running server — start it in background
      run(`${pm} cypress run --headless`);
      break;

    case 'mocha':
      run(`${pm} mocha --recursive`);
      break;

    default:
      // Try to find a test script in package.json
      if (profile.scripts?.test && profile.scripts.test !== 'echo "Error: no test specified"') {
        run(`${pm === 'npx' ? 'npm' : pm} test`);
      } else {
        console.log('⚠️  No test framework detected — skipping test stage.');
      }
  }
}

test();
