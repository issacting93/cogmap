#!/usr/bin/env npx tsx
/**
 * check-type-sync — Verify shared types between engine and scaffold haven't diverged.
 *
 * Parses both types.ts files and compares the overlapping type definitions.
 * Reports fields that are missing, added, or have different types.
 *
 * Usage: npx tsx scripts/check-type-sync.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENGINE_TYPES = resolve('engine/src/types.ts');
const SCAFFOLD_TYPES = resolve('scaffold/src/types.ts');

// Simple interface field parser — extracts { name: type } from interface blocks
function parseInterfaces(source: string): Map<string, Map<string, string>> {
  const interfaces = new Map<string, Map<string, string>>();
  const interfaceRegex = /export\s+interface\s+(\w+)\s*\{([^}]+)\}/g;

  let match;
  while ((match = interfaceRegex.exec(source)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields = new Map<string, string>();

    for (const line of body.split('\n')) {
      const fieldMatch = line.trim().match(/^(\w+)(\??):\s*(.+?);?\s*$/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1] + (fieldMatch[2] || '');
        const fieldType = fieldMatch[3].trim().replace(/;$/, '');
        fields.set(fieldName, fieldType);
      }
    }

    interfaces.set(name, fields);
  }

  return interfaces;
}

// Simple type alias parser — extracts type Name = 'a' | 'b'
function parseTypeAliases(source: string): Map<string, string> {
  const types = new Map<string, string>();
  const typeRegex = /export\s+type\s+(\w+)\s*=\s*(.+?);/g;

  let match;
  while ((match = typeRegex.exec(source)) !== null) {
    types.set(match[1], match[2].trim());
  }

  return types;
}

// ── Main ──

let engineSrc: string;
let scaffoldSrc: string;

try {
  engineSrc = readFileSync(ENGINE_TYPES, 'utf-8');
} catch {
  console.error(`Cannot read: ${ENGINE_TYPES}`);
  process.exit(1);
}

try {
  scaffoldSrc = readFileSync(SCAFFOLD_TYPES, 'utf-8');
} catch {
  console.error(`Cannot read: ${SCAFFOLD_TYPES}`);
  process.exit(1);
}

const engineInterfaces = parseInterfaces(engineSrc);
const scaffoldInterfaces = parseInterfaces(scaffoldSrc);
const engineTypes = parseTypeAliases(engineSrc);
const scaffoldTypes = parseTypeAliases(scaffoldSrc);

const errors: string[] = [];
const warnings: string[] = [];

// Compare type aliases
const sharedTypeNames = [...engineTypes.keys()].filter(k => scaffoldTypes.has(k));
for (const name of sharedTypeNames) {
  const eng = engineTypes.get(name)!;
  const scf = scaffoldTypes.get(name)!;
  if (eng !== scf) {
    errors.push(`Type "${name}" diverged:\n    engine:   ${eng}\n    scaffold: ${scf}`);
  }
}

// Compare interfaces
const sharedInterfaceNames = [...engineInterfaces.keys()].filter(k => scaffoldInterfaces.has(k));
for (const name of sharedInterfaceNames) {
  const engFields = engineInterfaces.get(name)!;
  const scfFields = scaffoldInterfaces.get(name)!;

  // Fields in both — check for type mismatches
  for (const [field, engType] of engFields) {
    const scfType = scfFields.get(field);
    if (scfType === undefined) {
      // Engine has it, scaffold doesn't — only warn, scaffold may intentionally omit
      continue;
    }
    if (engType !== scfType) {
      errors.push(`Interface "${name}.${field}" type mismatch:\n    engine:   ${engType}\n    scaffold: ${scfType}`);
    }
  }

  // Fields only in scaffold (additions)
  for (const [field] of scfFields) {
    if (!engFields.has(field)) {
      warnings.push(`Interface "${name}.${field}" exists in scaffold but not engine`);
    }
  }

  // Fields only in engine
  for (const [field] of engFields) {
    if (!scfFields.has(field)) {
      warnings.push(`Interface "${name}.${field}" exists in engine but not scaffold`);
    }
  }
}

// Interfaces only in one
for (const name of engineInterfaces.keys()) {
  if (!scaffoldInterfaces.has(name)) {
    // Engine-only interfaces are expected (SearchResult, etc.)
  }
}
for (const name of scaffoldInterfaces.keys()) {
  if (!engineInterfaces.has(name)) {
    warnings.push(`Interface "${name}" exists only in scaffold`);
  }
}

// ── Report ──

console.log('── Type Sync Report ──\n');
console.log(`  Shared type aliases: ${sharedTypeNames.length} (${sharedTypeNames.join(', ')})`);
console.log(`  Shared interfaces:   ${sharedInterfaceNames.length} (${sharedInterfaceNames.join(', ')})`);

if (warnings.length > 0) {
  console.log(`\n── Divergences (${warnings.length}) ──`);
  for (const w of warnings) console.log(`  INFO  ${w}`);
}

if (errors.length > 0) {
  console.log(`\n── Breaking Mismatches (${errors.length}) ──`);
  for (const e of errors) console.log(`  ERR   ${e}`);
  console.log('\nFAILED — shared types have diverged between engine and scaffold');
  process.exit(1);
}

console.log('\nPASSED');
