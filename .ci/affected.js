#!/usr/bin/env node
/**
 * Monorepo Affected Packages Detector
 * Compares git diff to find which packages changed,
 * then outputs a matrix for GitHub Actions parallel jobs.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getChangedFiles() {
  try {
    return execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch {
    // On first commit or shallow clone, return everything
    return execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');
  }
}

function findPackages() {
  const roots = ['packages', 'apps', 'libs', 'services'];
  const packages = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      const full = path.join(root, dir);
      if (fs.statSync(full).isDirectory()) {
        const pkg = path.join(full, 'package.json');
        if (fs.existsSync(pkg)) {
          const meta = JSON.parse(fs.readFileSync(pkg, 'utf8'));
          packages.push({ name: meta.name || dir, path: full, scripts: meta.scripts || {} });
        }
      }
    }
  }
  return packages;
}

function main() {
  const changed = getChangedFiles();
  const packages = findPackages();

  const affected = packages.filter(pkg =>
    changed.some(f => f.startsWith(pkg.path + '/'))
  );

  // If root-level files changed (shared config, etc.), run all packages
  const rootChanged = changed.some(f => !f.includes('/') || f.startsWith('.ci/'));
  const result = rootChanged ? packages : affected;

  const matrix = result.map(p => ({
    package: p.name,
    path: p.path,
    hasBuild: !!p.scripts.build,
    hasTest: !!p.scripts.test,
  }));

  const output = `matrix=${JSON.stringify(matrix)}`;

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, output + '\n');
  }

  console.log('\n📦 Affected packages:');
  console.table(result.map(p => ({ name: p.name, path: p.path })));
  console.log('\nMatrix:', JSON.stringify(matrix, null, 2));
}

main();
