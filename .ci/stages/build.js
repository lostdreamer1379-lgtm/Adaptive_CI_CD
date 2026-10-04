#!/usr/bin/env node
/**
 * Adaptive Build Stage
 * Reads CI_PROFILE and runs the right build command for the detected stack.
 */
const { execSync } = require('child_process');
const profile = JSON.parse(process.env.CI_PROFILE || '{}');

function run(cmd, env = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
}

function build() {
  const { type, language, buildTool, packageManager, scripts } = profile;
  const pm = packageManager === 'pnpm' ? 'pnpm' : packageManager === 'yarn' ? 'yarn' : 'npm';

  if (language === 'python') {
    // Python: build a wheel/sdist if setup.py or pyproject.toml exists
    if (require('fs').existsSync('pyproject.toml') || require('fs').existsSync('setup.py')) {
      run('python -m build');
    } else {
      console.log('ℹ️  Python project — no build step needed.');
    }
    return;
  }

  if (language === 'go') {
    run('go build -v -o ./bin/app ./...');
    return;
  }

  if (language === 'rust') {
    run('cargo build --release');
    return;
  }

  // JavaScript / TypeScript — use package.json build script if present
  if (scripts?.build) {
    run(`${pm} run build`, { NODE_ENV: 'production' });
    return;
  }

  // Fallback: invoke build tool directly
  switch (buildTool) {
    case 'vite':
      run(`${pm === 'npm' ? 'npx' : pm} vite build`);
      break;
    case 'next':
      run(`${pm === 'npm' ? 'npx' : pm} next build`);
      break;
    case 'tsc':
      run('npx tsc --project tsconfig.json');
      break;
    case 'webpack':
      run('npx webpack --mode production');
      break;
    case 'rollup':
      run('npx rollup -c');
      break;
    case 'esbuild':
      run('npx esbuild src/index.ts --bundle --outfile=dist/index.js');
      break;
    default:
      console.log(`⚠️  No build tool detected for type "${type}" — skipping build.`);
  }
}

build();
