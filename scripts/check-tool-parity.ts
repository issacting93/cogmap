#!/usr/bin/env npx tsx
/**
 * check-tool-parity — Verify MCP tools registered in index.ts match skill references.
 *
 * Parses engine/src/index.ts for server.tool() calls and skill/*.md files for
 * tool name references. Reports tools with no skill coverage and skill references
 * to non-existent tools.
 *
 * Usage: npx tsx scripts/check-tool-parity.ts
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

const INDEX_PATH = resolve('engine/src/index.ts');
const SKILL_DIR = resolve('skill');

// ── Parse MCP tool registrations ──

function parseTools(source: string): Map<string, { name: string; description: string }> {
  const tools = new Map<string, { name: string; description: string }>();
  // Match: server.tool('name', 'description', ...
  const toolRegex = /server\.tool\(\s*'([^']+)',\s*'([^']+)'/g;

  let match;
  while ((match = toolRegex.exec(source)) !== null) {
    tools.set(match[1], { name: match[1], description: match[2].slice(0, 80) });
  }

  return tools;
}

// ── Parse skill files for tool references ──

function parseSkillReferences(skillDir: string): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();

  let files: string[];
  try {
    files = readdirSync(skillDir).filter(f => f.endsWith('.md'));
  } catch {
    return refs;
  }

  for (const file of files) {
    const content = readFileSync(resolve(skillDir, file), 'utf-8');
    const skillName = basename(file, '.md');
    const toolRefs = new Set<string>();

    // Match cogmap_* tool names in the content
    const refRegex = /\b(cogmap_\w+)\b/g;
    let match;
    while ((match = refRegex.exec(content)) !== null) {
      toolRefs.add(match[1]);
    }

    if (toolRefs.size > 0) {
      refs.set(skillName, toolRefs);
    }
  }

  return refs;
}

// ── Main ──

let indexSrc: string;
try {
  indexSrc = readFileSync(INDEX_PATH, 'utf-8');
} catch {
  console.error(`Cannot read: ${INDEX_PATH}`);
  process.exit(1);
}

const registeredTools = parseTools(indexSrc);
const skillRefs = parseSkillReferences(SKILL_DIR);

const errors: string[] = [];
const warnings: string[] = [];

// All tool names referenced across all skills
const allReferencedTools = new Set<string>();
for (const [, refs] of skillRefs) {
  for (const ref of refs) allReferencedTools.add(ref);
}

// Tools with no skill coverage
for (const [toolName] of registeredTools) {
  if (!allReferencedTools.has(toolName)) {
    warnings.push(`Tool "${toolName}" has no skill referencing it`);
  }
}

// Skill references to non-existent tools
for (const [skillName, refs] of skillRefs) {
  for (const ref of refs) {
    if (!registeredTools.has(ref)) {
      errors.push(`Skill "${skillName}" references non-existent tool "${ref}"`);
    }
  }
}

// ── Report ──

console.log('── Tool-Skill Parity Report ──\n');
console.log(`  Registered MCP tools: ${registeredTools.size}`);
for (const [name, info] of registeredTools) {
  console.log(`    ${name}: ${info.description}`);
}

console.log(`\n  Skills found: ${skillRefs.size}`);
for (const [name, refs] of skillRefs) {
  console.log(`    ${name}: references ${[...refs].join(', ')}`);
}

if (warnings.length > 0) {
  console.log(`\n── Gaps (${warnings.length}) ──`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
}

if (errors.length > 0) {
  console.log(`\n── Errors (${errors.length}) ──`);
  for (const e of errors) console.log(`  ERR   ${e}`);
  console.log('\nFAILED');
  process.exit(1);
}

console.log('\nPASSED');
