#!/usr/bin/env node

/**
 * cogmap — cognitive map scaffolding for any project.
 *
 * Commands:
 *   npx cogmap              Scaffold a new map (alias for init)
 *   npx cogmap init         Scaffold a new map
 *   npx cogmap upgrade      Update an existing map-viewer to the latest scaffold
 *
 * Options:
 *   --name "Project Name"   Set the project name (defaults to directory name)
 */

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, basename, relative, join } from 'path';
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
} else if (command === 'upgrade') {
  upgrade();
} else if (command === 'version' || command === '--version' || command === '-v') {
  const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf-8'));
  console.log(`cogmap v${pkg.version}`);
} else {
  console.log('Usage:');
  console.log('  cogmap init [--name "Project Name"]   Scaffold a new map');
  console.log('  cogmap upgrade                        Update existing map to latest');
  console.log('  cogmap version                        Show version');
  process.exit(1);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function getProjectName() {
  const nameIdx = args.indexOf('--name');
  return nameIdx !== -1 && args[nameIdx + 1]
    ? args[nameIdx + 1]
    : basename(CWD);
}

function patchProjectName(filePath, projectName) {
  if (!existsSync(filePath)) return;
  let content = readFileSync(filePath, 'utf-8');
  if (content.includes('{{PROJECT_NAME}}')) {
    content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
    writeFileSync(filePath, content);
  }
}

/* ── Init ─────────────────────────────────────────────────────────────────── */

function init() {
  const projectName = getProjectName();
  const viewerDir = resolve(CWD, 'map-viewer');
  const skillDir = resolve(CWD, '.claude', 'commands');

  // 1. Copy scaffold → map-viewer/
  if (existsSync(viewerDir)) {
    console.log('  map-viewer/ already exists — skipping scaffold copy');
    console.log('  (run `npx cogmap upgrade` to update, or delete map-viewer/ for a fresh scaffold)');
  } else {
    console.log(`  Scaffolding map-viewer/ for "${projectName}"...`);
    cpSync(resolve(PKG_ROOT, 'scaffold'), viewerDir, { recursive: true });
    patchProjectName(resolve(viewerDir, 'index.html'), projectName);
    patchProjectName(resolve(viewerDir, 'src', 'map', 'MapTerrainView.tsx'), projectName.toUpperCase());
  }

  // 2. Copy skills
  mkdirSync(skillDir, { recursive: true });
  for (const skill of ['update-map.md', 'query-map.md', 'map-context.md']) {
    const dest = resolve(skillDir, skill);
    if (existsSync(dest)) {
      console.log(`  .claude/commands/${skill} already exists — skipping`);
    } else {
      console.log(`  Installing /${skill.replace('.md', '')} skill...`);
      cpSync(resolve(PKG_ROOT, 'skill', skill), dest);
    }
  }

  // 3. Copy engine scaffold → map-engine/
  const engineDir = resolve(CWD, 'map-engine');
  if (existsSync(engineDir)) {
    console.log('  map-engine/ already exists — skipping engine scaffold');
  } else {
    console.log('  Scaffolding map-engine/ (query engine + MCP server)...');
    cpSync(resolve(PKG_ROOT, 'engine'), engineDir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes('data'),
    });
  }

  // 4. Configure MCP server
  configureMcp(engineDir);

  // 5. Install dependencies
  installDeps(viewerDir, 'viewer');
  installDeps(engineDir, 'engine');

  console.log('');
  console.log(`  Done. Your cognitive map is ready.`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. cd map-viewer && npm run dev');
  console.log('    2. Run /update-map in Claude Code to populate the map');
  console.log('    3. Use cogmap_search, cogmap_context, etc. MCP tools to query');
  console.log('');
}

/* ── Upgrade ──────────────────────────────────────────────────────────────── */

// Files that are never overwritten — they contain user data or customizations.
const PRESERVE = new Set([
  'src/seed.ts',
]);

function upgrade() {
  const viewerDir = resolve(CWD, 'map-viewer');
  const engineDir = resolve(CWD, 'map-engine');
  const skillDir = resolve(CWD, '.claude', 'commands');
  const scaffoldDir = resolve(PKG_ROOT, 'scaffold');
  const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf-8'));

  if (!existsSync(viewerDir)) {
    console.log('  No map-viewer/ found. Run `npx cogmap init` first.');
    process.exit(1);
  }

  console.log(`  Upgrading to cogmap v${pkg.version}...`);
  console.log('');

  // Detect existing project name from index.html title
  let projectName = basename(CWD);
  const indexPath = resolve(viewerDir, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf-8');
    const match = html.match(/<title>(.+?)<\/title>/);
    if (match && match[1]) projectName = match[1];
  }

  // Walk scaffold and update map-viewer/
  const updated = [];
  const preserved = [];
  const added = [];

  function walkAndSync(dir) {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const srcPath = join(dir, entry);
      const relPath = relative(scaffoldDir, srcPath);
      const destPath = resolve(viewerDir, relPath);
      const stat = statSync(srcPath);

      // Skip node_modules, dist, package-lock
      if (entry === 'node_modules' || entry === 'dist' || entry === 'package-lock.json') continue;

      if (stat.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        walkAndSync(srcPath);
      } else {
        if (PRESERVE.has(relPath)) {
          preserved.push(relPath);
          continue;
        }

        const exists = existsSync(destPath);
        let srcContent = readFileSync(srcPath, 'utf-8');

        // Apply project name template
        srcContent = srcContent.replace(/\{\{PROJECT_NAME\}\}/g, projectName.toUpperCase());

        // Check if content actually differs
        if (exists) {
          const destContent = readFileSync(destPath, 'utf-8');
          if (destContent === srcContent) continue; // identical, skip
          updated.push(relPath);
        } else {
          added.push(relPath);
        }

        writeFileSync(destPath, srcContent);
      }
    }
  }

  walkAndSync(scaffoldDir);

  // Update skills (always overwrite — they're not user-editable)
  mkdirSync(skillDir, { recursive: true });
  for (const skill of ['update-map.md', 'query-map.md', 'map-context.md']) {
    const src = resolve(PKG_ROOT, 'skill', skill);
    const dest = resolve(skillDir, skill);
    if (existsSync(src)) {
      cpSync(src, dest);
    }
  }

  // Update engine
  if (existsSync(engineDir)) {
    console.log('  Updating map-engine/...');
    cpSync(resolve(PKG_ROOT, 'engine'), engineDir, {
      recursive: true,
      filter: (src) => !src.includes('node_modules') && !src.includes('data'),
    });
  }

  // Reconfigure MCP server
  configureMcp(engineDir);

  // Install any new dependencies
  installDeps(viewerDir, 'viewer');
  if (existsSync(engineDir)) installDeps(engineDir, 'engine');

  // Report
  console.log('');
  if (added.length > 0) {
    console.log(`  Added (${added.length}):`);
    added.forEach(f => console.log(`    + ${f}`));
  }
  if (updated.length > 0) {
    console.log(`  Updated (${updated.length}):`);
    updated.forEach(f => console.log(`    ~ ${f}`));
  }
  if (preserved.length > 0) {
    console.log(`  Preserved (${preserved.length}):`);
    preserved.forEach(f => console.log(`    = ${f}`));
  }
  if (added.length === 0 && updated.length === 0) {
    console.log('  Already up to date.');
  }

  console.log('');
  console.log(`  Upgrade to v${pkg.version} complete.`);
  console.log('  Skills updated. Vite will hot-reload any changed files.');
  console.log('');
}

/* ── Shared helpers ───────────────────────────────────────────────────────── */

function configureMcp(engineDir) {
  const settingsPath = resolve(CWD, '.claude', 'settings.local.json');
  const mcpConfig = {
    mcpServers: {
      cogmap: {
        command: 'npx',
        args: ['tsx', resolve(engineDir, 'src', 'index.ts')],
        cwd: CWD,
        env: {
          COGMAP_SEED_PATH: resolve(CWD, 'map-viewer', 'src', 'seed.ts'),
          COGMAP_DB_PATH: resolve(engineDir, 'data', 'cogmap.db'),
        },
      },
    },
  };

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch { /* start fresh */ }
  }
  deepMerge(settings, mcpConfig);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('  Configured cogmap MCP server in .claude/settings.local.json');
}

function installDeps(dir, label) {
  if (!existsSync(dir)) return;
  console.log(`  Installing ${label} dependencies...`);
  try {
    execSync('npm install', { cwd: dir, stdio: 'inherit' });
  } catch {
    console.log(`  npm install failed — run it manually in ${basename(dir)}/`);
  }
}
