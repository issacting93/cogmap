#!/usr/bin/env npx tsx
/**
 * validate-seed — Validate seed.ts structure and referential integrity.
 *
 * Usage: npx tsx scripts/validate-seed.ts [path/to/seed.ts]
 * Exit codes: 0 = pass, 1 = errors found
 */

import { resolve } from 'path';
import { existsSync } from 'fs';

const VALID_LEVELS = new Set(['world', 'parts', 'aspects', 'points', 'stories']);
const VALID_TIERS = new Set(['lt', 'st']);
const KNOWN_EDGE_TYPES = new Set([
  'DEPENDS_ON', 'PRODUCES', 'VALIDATES', 'BLOCKS', 'IMPLEMENTS',
  'DOCUMENTS', 'RELATED_TO', 'MAPS_TO', 'OPERATIONALIZES',
]);

interface ValidationResult {
  errors: string[];
  warnings: string[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    hubCount: number;
    worldCount: number;
    byLevel: Record<string, number>;
    byTier: Record<string, number>;
    missingStory: number;
  };
}

async function validateSeed(seedPath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Dynamic import with cache-busting
  const mod = await import(`${seedPath}?t=${Date.now()}`);
  const nodes: unknown[] = mod.nodes ?? [];
  const crossEdges: unknown[] = mod.crossEdges ?? [];

  if (!Array.isArray(nodes)) {
    errors.push('`nodes` export is not an array');
    return { errors, warnings, stats: emptyStats() };
  }
  if (!Array.isArray(crossEdges)) {
    errors.push('`crossEdges` export is not an array');
    return { errors, warnings, stats: emptyStats() };
  }

  if (nodes.length === 0) {
    errors.push('`nodes` array is empty');
    return { errors, warnings, stats: emptyStats() };
  }

  // ── Node validation ──

  const nodeIds = new Set<string>();
  const byLevel: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  let missingStory = 0;

  for (const raw of nodes) {
    const node = raw as Record<string, unknown>;

    if (!node.id || typeof node.id !== 'string') {
      errors.push(`Node missing or invalid 'id': ${JSON.stringify(node).slice(0, 80)}`);
      continue;
    }

    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node ID: "${node.id}"`);
    }
    nodeIds.add(node.id);

    // Level
    if (!VALID_LEVELS.has(node.level as string)) {
      errors.push(`Node "${node.id}": invalid level "${node.level}"`);
    }
    byLevel[node.level as string] = (byLevel[node.level as string] ?? 0) + 1;

    // Tier
    if (!VALID_TIERS.has(node.tier as string)) {
      errors.push(`Node "${node.id}": invalid tier "${node.tier}"`);
    }
    byTier[node.tier as string] = (byTier[node.tier as string] ?? 0) + 1;

    // Label
    if (!node.label || typeof node.label !== 'string') {
      errors.push(`Node "${node.id}": missing or invalid 'label'`);
    }

    // Story
    if (node.level !== 'world' && (!node.story || (node.story as string).trim() === '')) {
      missingStory++;
      if (node.level === 'parts') {
        warnings.push(`Hub "${node.id}": missing story — hubs should always have stories`);
      }
    }

    // Coordinates
    if (typeof node.x !== 'number' || typeof node.y !== 'number') {
      warnings.push(`Node "${node.id}": non-numeric coordinates`);
    }
  }

  // ── Parent references ──

  for (const raw of nodes) {
    const node = raw as Record<string, unknown>;
    if (node.parentId !== null && node.parentId !== undefined && !nodeIds.has(node.parentId as string)) {
      errors.push(`Node "${node.id}": references non-existent parent "${node.parentId}"`);
    }
  }

  // ── World node checks ──

  const worldNodes = nodes.filter((n: any) => n.level === 'world');
  if (worldNodes.length === 0) {
    errors.push('No world-level node found — map needs exactly one root');
  } else if (worldNodes.length > 1) {
    errors.push(`Multiple world nodes: ${worldNodes.map((n: any) => n.id).join(', ')}`);
  } else {
    const world = worldNodes[0] as Record<string, unknown>;
    if (world.parentId !== null) {
      warnings.push('World node should have parentId: null');
    }
  }

  // ── Hub checks ──

  const hubs = nodes.filter((n: any) => n.level === 'parts');
  for (const raw of hubs) {
    const hub = raw as Record<string, unknown>;
    const children = nodes.filter((n: any) => n.parentId === hub.id);
    if (children.length === 0) {
      warnings.push(`Hub "${hub.id}": has no children`);
    } else if (children.length === 1) {
      warnings.push(`Hub "${hub.id}": only 1 child — consider expanding`);
    }
  }

  // ── Hierarchy checks ──

  for (const raw of worldNodes) {
    const world = raw as Record<string, unknown>;
    const worldChildren = nodes.filter((n: any) => n.parentId === world.id);
    const nonPartChildren = worldChildren.filter((n: any) => n.level !== 'parts');
    if (nonPartChildren.length > 0) {
      warnings.push(`World node has non-hub children: ${nonPartChildren.map((n: any) => n.id).join(', ')}`);
    }
  }

  // Nodes should not skip levels
  const levelOrder = ['world', 'parts', 'aspects', 'points', 'stories'];
  for (const raw of nodes) {
    const node = raw as Record<string, unknown>;
    if (!node.parentId) continue;
    const parent = nodes.find((n: any) => n.id === node.parentId) as Record<string, unknown> | undefined;
    if (!parent) continue;
    const nodeDepth = levelOrder.indexOf(node.level as string);
    const parentDepth = levelOrder.indexOf(parent.level as string);
    if (nodeDepth >= 0 && parentDepth >= 0 && nodeDepth - parentDepth > 1) {
      warnings.push(`Node "${node.id}" (${node.level}) skips a level under parent "${parent.id}" (${parent.level})`);
    }
  }

  // ── Node count guidance ──

  const nonWorldCount = nodes.filter((n: any) => n.level !== 'world').length;
  if (nonWorldCount < 10) {
    warnings.push(`Only ${nonWorldCount} non-world nodes — map may be too sparse`);
  } else if (nonWorldCount > 100) {
    warnings.push(`${nonWorldCount} non-world nodes — map may be too dense (target 40-80)`);
  }

  // ── Cross-edge validation ──

  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();

  for (const raw of crossEdges) {
    const edge = raw as Record<string, unknown>;

    if (!edge.id || typeof edge.id !== 'string') {
      errors.push(`Edge missing or invalid 'id': ${JSON.stringify(edge).slice(0, 80)}`);
      continue;
    }

    if (edgeIds.has(edge.id as string)) {
      errors.push(`Duplicate edge ID: "${edge.id}"`);
    }
    edgeIds.add(edge.id as string);

    if (!nodeIds.has(edge.sourceAnchorId as string)) {
      errors.push(`Edge "${edge.id}": non-existent source "${edge.sourceAnchorId}"`);
    }
    if (!nodeIds.has(edge.targetAnchorId as string)) {
      errors.push(`Edge "${edge.id}": non-existent target "${edge.targetAnchorId}"`);
    }
    if (edge.sourceAnchorId === edge.targetAnchorId) {
      errors.push(`Edge "${edge.id}": self-loop on "${edge.sourceAnchorId}"`);
    }
    if (!KNOWN_EDGE_TYPES.has(edge.edgeType as string)) {
      warnings.push(`Edge "${edge.id}": non-standard type "${edge.edgeType}"`);
    }
    if (typeof edge.confidence !== 'number' || edge.confidence < 0 || edge.confidence > 1) {
      errors.push(`Edge "${edge.id}": invalid confidence ${edge.confidence} (must be 0-1)`);
    }

    const pair = `${edge.sourceAnchorId}->${edge.targetAnchorId}:${edge.edgeType}`;
    if (edgePairs.has(pair)) {
      warnings.push(`Duplicate edge pair: ${pair}`);
    }
    edgePairs.add(pair);
  }

  return {
    errors,
    warnings,
    stats: {
      nodeCount: nodes.length,
      edgeCount: crossEdges.length,
      hubCount: hubs.length,
      worldCount: worldNodes.length,
      byLevel,
      byTier,
      missingStory,
    },
  };
}

function emptyStats() {
  return { nodeCount: 0, edgeCount: 0, hubCount: 0, worldCount: 0, byLevel: {}, byTier: {}, missingStory: 0 };
}

// ── Main ──

const seedArg = process.argv[2];
let seedPath = resolve(seedArg ?? 'map-viewer/src/seed.ts');

if (!existsSync(seedPath)) {
  const alt = resolve('scaffold/src/seed.ts');
  if (existsSync(alt)) {
    seedPath = alt;
  } else {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }
}

console.log(`Validating: ${seedPath}\n`);

try {
  const result = await validateSeed(seedPath);

  // Print stats
  console.log('── Stats ──');
  console.log(`  Nodes: ${result.stats.nodeCount} (${result.stats.hubCount} hubs)`);
  console.log(`  Edges: ${result.stats.edgeCount}`);
  console.log(`  By level: ${Object.entries(result.stats.byLevel).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  By tier:  ${Object.entries(result.stats.byTier).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (result.stats.missingStory > 0) {
    console.log(`  Missing story: ${result.stats.missingStory} nodes`);
  }

  // Print warnings
  if (result.warnings.length > 0) {
    console.log(`\n── Warnings (${result.warnings.length}) ──`);
    for (const w of result.warnings) {
      console.log(`  WARN  ${w}`);
    }
  }

  // Print errors
  if (result.errors.length > 0) {
    console.log(`\n── Errors (${result.errors.length}) ──`);
    for (const e of result.errors) {
      console.log(`  ERR   ${e}`);
    }
    console.log('\nFAILED');
    process.exit(1);
  }

  console.log('\nPASSED');
} catch (err) {
  console.error('Failed to load seed file:', err);
  process.exit(1);
}
