#!/usr/bin/env node

/**
 * cogmap init
 *
 * Scaffolds a map-viewer/ Vite app and a /update-map skill
 * into the current project directory.
 *
 * Usage:
 *   npx cogmap init
 *   npx cogmap init --name "My Project"
 */

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const CWD = process.cwd();

// Parse args
const args = process.argv.slice(2);
const command = args[0];

if (command === 'init' || !command) {
  init();
} else {
  console.log('Usage: cogmap init [--name "Project Name"]');
  process.exit(1);
}

function init() {
  const nameIdx = args.indexOf('--name');
  const projectName = nameIdx !== -1 && args[nameIdx + 1]
    ? args[nameIdx + 1]
    : basename(CWD);

  const viewerDir = resolve(CWD, 'map-viewer');
  const skillDir = resolve(CWD, '.claude', 'commands');

  // 1. Copy scaffold → map-viewer/
  if (existsSync(viewerDir)) {
    console.log('  map-viewer/ already exists — skipping scaffold copy');
    console.log('  (delete it first if you want a fresh scaffold)');
  } else {
    console.log(`  Scaffolding map-viewer/ for "${projectName}"...`);
    cpSync(resolve(PKG_ROOT, 'scaffold'), viewerDir, { recursive: true });

    // Patch title in index.html
    const indexPath = resolve(viewerDir, 'index.html');
    let html = readFileSync(indexPath, 'utf-8');
    html = html.replace('{{PROJECT_NAME}}', projectName);
    writeFileSync(indexPath, html);

    // Patch brand in MapTerrainView
    const mtvPath = resolve(viewerDir, 'src', 'map', 'MapTerrainView.tsx');
    let mtv = readFileSync(mtvPath, 'utf-8');
    mtv = mtv.replace('{{PROJECT_NAME}}', projectName.toUpperCase());
    writeFileSync(mtvPath, mtv);
  }

  // 2. Copy skill → .claude/commands/update-map.md
  mkdirSync(skillDir, { recursive: true });
  const skillDest = resolve(skillDir, 'update-map.md');
  if (existsSync(skillDest)) {
    console.log('  .claude/commands/update-map.md already exists — skipping');
  } else {
    console.log('  Installing /update-map skill...');
    cpSync(resolve(PKG_ROOT, 'skill', 'update-map.md'), skillDest);
  }

  // 3. Install dependencies
  console.log('  Installing dependencies...');
  try {
    execSync('npm install', { cwd: viewerDir, stdio: 'inherit' });
  } catch {
    console.log('  npm install failed — run it manually in map-viewer/');
  }

  console.log('');
  console.log(`  Done. Your cognitive map is ready.`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. cd map-viewer && npm run dev');
  console.log('    2. Run /update-map in Claude Code to populate the map');
  console.log('');
}
