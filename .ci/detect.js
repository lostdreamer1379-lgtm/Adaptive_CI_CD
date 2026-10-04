#!/usr/bin/env node
/**
 * Adaptive CI/CD - Project Intelligence Engine
 * Scans the repo and emits a full project profile used by all pipeline stages.
 * Output is written to GITHUB_OUTPUT (or stdout if running locally).
 */

const fs = require('fs');
const path = require('path');

// ─── Utility ─────────────────────────────────────────────────────────────────

function exists(p) { return fs.existsSync(p); }
function read(p)   { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function readJSON(p) { try { return JSON.parse(read(p)); } catch { return null; } }

function glob(dir, ext) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(ext));
}

// ─── Detection Rules ─────────────────────────────────────────────────────────

function detectPackageManager() {
  if (exists('pnpm-lock.yaml')) return 'pnpm';
  if (exists('yarn.lock'))      return 'yarn';
  if (exists('bun.lockb'))      return 'bun';
  return 'npm';
}

function detectProjectType(pkg) {
  if (!pkg) {
    if (exists('pyproject.toml') || exists('requirements.txt') || exists('setup.py')) return 'python';
    if (exists('go.mod'))       return 'go';
    if (exists('Cargo.toml'))   return 'rust';
    if (exists('pom.xml') || exists('build.gradle')) return 'java';
    if (exists('composer.json')) return 'php';
    return 'unknown';
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps['next'])         return 'nextjs';
  if (deps['react'])        return 'react';
  if (deps['nuxt'])         return 'nuxt';
  if (deps['vue'])          return 'vue';
  if (deps['@sveltejs/kit'] || deps['svelte']) return 'svelte';
  if (deps['astro'])        return 'astro';
  if (deps['remix'])        return 'remix';
  if (deps['express'] || deps['fastify'] || deps['koa']) return 'node-api';
  if (deps['electron'])     return 'electron';
  return 'node';
}

function detectBuildTool(pkg) {
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['vite'])         return 'vite';
  if (deps['turbopack'] || deps['next']) return 'next';
  if (deps['webpack'])      return 'webpack';
  if (deps['parcel'])       return 'parcel';
  if (deps['rollup'])       return 'rollup';
  if (deps['esbuild'])      return 'esbuild';
  return 'tsc';
}

function detectTestFramework(pkg) {
  if (!pkg) {
    if (exists('pytest.ini') || read('pyproject.toml').includes('[tool.pytest')) return 'pytest';
    return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['vitest'])       return 'vitest';
  if (deps['jest'])         return 'jest';
  if (deps['mocha'])        return 'mocha';
  if (deps['playwright'])   return 'playwright';
  if (deps['cypress'])      return 'cypress';
  return null;
}

function detectLinter(pkg) {
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['eslint'])       return 'eslint';
  if (deps['biome'])        return 'biome';
  if (deps['xo'])           return 'xo';
  return null;
}

function detectFormatter(pkg) {
  if (!pkg) return null;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['prettier'])     return 'prettier';
  if (deps['biome'])        return 'biome';
  return null;
}

function detectTypecheck(pkg) {
  if (!pkg) return false;
  return exists('tsconfig.json') || !!pkg.devDependencies?.typescript;
}

function detectDeployTarget() {
  if (exists('vercel.json') || exists('.vercel'))           return 'vercel';
  if (exists('netlify.toml') || exists('.netlify'))         return 'netlify';
  if (exists('fly.toml'))                                   return 'fly';
  if (exists('railway.toml'))                               return 'railway';
  if (exists('render.yaml'))                                return 'render';
  if (exists('heroku.yml') || exists('Procfile'))           return 'heroku';
  if (exists('k8s') || exists('kubernetes'))                return 'kubernetes';
  if (exists('Dockerfile') || exists('docker-compose.yml')) return 'docker';
  if (read('.github/workflows/main.yml').includes('aws'))   return 'aws';
  return 'none';
}

function detectMonorepo(pkg) {
  if (exists('pnpm-workspace.yaml')) return { tool: 'pnpm', packages: parseWorkspaces('pnpm') };
  if (exists('lerna.json'))          return { tool: 'lerna', packages: [] };
  if (exists('nx.json'))             return { tool: 'nx', packages: [] };
  if (exists('turbo.json'))          return { tool: 'turbo', packages: [] };
  if (pkg?.workspaces)               return { tool: 'npm', packages: pkg.workspaces };
  return null;
}

function parseWorkspaces(tool) {
  if (tool === 'pnpm') {
    const yaml = read('pnpm-workspace.yaml');
    const match = yaml.match(/packages:\s*([\s\S]*?)(?:\n\w|$)/);
    if (match) return match[1].trim().split('\n').map(l => l.trim().replace(/^- ['"]?|['"]?$/g, ''));
  }
  return [];
}

function detectCoverageConfig(pkg) {
  if (!pkg) return 80;
  const vitestConfig = read('vite.config.ts') + read('vite.config.js') + read('vitest.config.ts');
  const match = vitestConfig.match(/lines['":\s]+(\d+)/);
  return match ? parseInt(match[1]) : 80;
}

function detectEnvironments() {
  const envFiles = ['.env', '.env.example', '.env.local', '.env.staging', '.env.production']
    .filter(exists);
  return {
    hasEnvExample: exists('.env.example'),
    requiredVars: extractEnvVars('.env.example'),
    envFiles,
  };
}

function extractEnvVars(file) {
  if (!exists(file)) return [];
  return read(file)
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => l.split('=')[0].trim());
}

function detectSecurityTools(pkg) {
  const tools = [];
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['snyk'])      tools.push('snyk');
    if (deps['audit-ci']) tools.push('audit-ci');
  }
  if (exists('.snyk')) tools.push('snyk');
  return tools.length ? tools : ['npm-audit'];
}

function detectNotifications() {
  const channels = [];
  if (read('.github/workflows/').includes('slack')) channels.push('slack');
  if (read('.github/workflows/').includes('discord')) channels.push('discord');
  return channels;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function analyze() {
  const pkg = readJSON('package.json');
  const type = detectProjectType(pkg);
  const pm   = detectPackageManager();

  const profile = {
    // Identity
    name:        pkg?.name || path.basename(process.cwd()),
    version:     pkg?.version || '0.0.0',
    type,
    language:    pkg ? 'javascript' : type === 'python' ? 'python' : type === 'go' ? 'go' : 'unknown',
    isTypescript: detectTypecheck(pkg),

    // Tooling
    packageManager: pm,
    buildTool:      detectBuildTool(pkg),
    testFramework:  detectTestFramework(pkg),
    linter:         detectLinter(pkg),
    formatter:      detectFormatter(pkg),

    // Features
    hasTests:        !!detectTestFramework(pkg),
    hasLint:         !!detectLinter(pkg),
    hasBuild:        !!(pkg?.scripts?.build || exists('Dockerfile')),
    hasDocker:       exists('Dockerfile'),
    hasTypecheck:    detectTypecheck(pkg),
    hasCoverage:     !!detectTestFramework(pkg),
    coverageThreshold: detectCoverageConfig(pkg),
    securityTools:   detectSecurityTools(pkg),

    // Deploy
    deployTarget:    detectDeployTarget(),
    monorepo:        detectMonorepo(pkg),
    environments:    detectEnvironments(),

    // Scripts (from package.json)
    scripts: pkg?.scripts || {},

    // Notifications
    notifications:   detectNotifications(),
  };

  return profile;
}

const profile = analyze();

// Write to GITHUB_OUTPUT or print to stdout
const output = `profile=${JSON.stringify(profile)}`;
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
  console.log('✅ Profile written to GITHUB_OUTPUT');
  console.log(JSON.stringify(profile, null, 2));
} else {
  // Local run — pretty print
  console.log('\n🔍 Detected Project Profile:\n');
  console.log(JSON.stringify(profile, null, 2));
  console.log('\n📤 GITHUB_OUTPUT value:\n');
  console.log(output);
}
