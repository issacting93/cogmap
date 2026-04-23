#!/usr/bin/env npx tsx
/**
 * graph-integrity — Check graph structure: connectivity, orphans, cycles, hierarchy.
 *
 * Usage: npx tsx scripts/graph-integrity.ts [path/to/seed.ts]
 */

import { resolve } from 'path';
import { existsSync } from 'fs';

interface Node {
  id: string;
  label: string;
  level: string;
  tier: string;
  parentId: string | null;
  story?: string;
}

interface Edge {
  id: string;
  sourceAnchorId: string;
  targetAnchorId: string;
  edgeType: string;
  confidence: number;
}

async function checkIntegrity(seedPath: string) {
  const mod = await import(`${seedPath}?t=${Date.now()}`);
  const nodes: Node[] = mod.nodes ?? [];
  const crossEdges: Edge[] = mod.crossEdges ?? [];

  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeMap = new Map<string, Node>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // ── Build adjacency list (undirected: hierarchy + cross-edges) ──

  const adj = new Map<string, Set<string>>();
  const ensureAdj = (id: string) => { if (!adj.has(id)) adj.set(id, new Set()); };

  for (const n of nodes) {
    ensureAdj(n.id);
    if (n.parentId && nodeMap.has(n.parentId)) {
      ensureAdj(n.parentId);
      adj.get(n.id)!.add(n.parentId);
      adj.get(n.parentId)!.add(n.id);
    }
  }

  for (const e of crossEdges) {
    if (nodeMap.has(e.sourceAnchorId) && nodeMap.has(e.targetAnchorId)) {
      ensureAdj(e.sourceAnchorId);
      ensureAdj(e.targetAnchorId);
      adj.get(e.sourceAnchorId)!.add(e.targetAnchorId);
      adj.get(e.targetAnchorId)!.add(e.sourceAnchorId);
    }
  }

  // ── Connected components ──

  const visited = new Set<string>();
  const components: string[][] = [];

  function bfs(start: string): string[] {
    const queue = [start];
    const component: string[] = [];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of (adj.get(current) ?? [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return component;
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) {
      components.push(bfs(n.id));
    }
  }

  if (components.length > 1) {
    errors.push(`Graph has ${components.length} disconnected components`);
    for (let i = 1; i < components.length; i++) {
      const labels = components[i].slice(0, 5).map(id => nodeMap.get(id)?.label ?? id);
      errors.push(`  Component ${i + 1} (${components[i].length} nodes): ${labels.join(', ')}${components[i].length > 5 ? '...' : ''}`);
    }
  }

  // ── Orphan detection (leaf nodes with no cross-edges) ──

  const crossEdgeNodes = new Set<string>();
  for (const e of crossEdges) {
    crossEdgeNodes.add(e.sourceAnchorId);
    crossEdgeNodes.add(e.targetAnchorId);
  }

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId) {
      if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
      childrenOf.get(n.parentId)!.push(n.id);
    }
  }

  for (const n of nodes) {
    const hasChildren = (childrenOf.get(n.id) ?? []).length > 0;
    const hasCrossEdges = crossEdgeNodes.has(n.id);
    if (!hasChildren && !hasCrossEdges && n.level !== 'world') {
      // It's a leaf with no cross-edges — not necessarily bad, but worth flagging if isolated
      if (!n.parentId || !nodeMap.has(n.parentId)) {
        warnings.push(`Orphan node "${n.id}" (${n.label}): no parent, no children, no cross-edges`);
      }
    }
  }

  // ── Hierarchy cycle detection ──

  function detectCycle(startId: string): string[] | null {
    const path: string[] = [];
    const inPath = new Set<string>();

    function dfs(id: string): string[] | null {
      if (inPath.has(id)) {
        const cycleStart = path.indexOf(id);
        return path.slice(cycleStart).concat(id);
      }
      if (!nodeMap.has(id)) return null;
      const node = nodeMap.get(id)!;
      if (!node.parentId) return null;

      inPath.add(id);
      path.push(id);
      const result = dfs(node.parentId);
      path.pop();
      inPath.delete(id);
      return result;
    }

    return dfs(startId);
  }

  const checkedForCycles = new Set<string>();
  for (const n of nodes) {
    if (checkedForCycles.has(n.id)) continue;
    const cycle = detectCycle(n.id);
    if (cycle) {
      errors.push(`Hierarchy cycle detected: ${cycle.map(id => nodeMap.get(id)?.label ?? id).join(' -> ')}`);
      for (const id of cycle) checkedForCycles.add(id);
    }
  }

  // ── Hub balance ──

  const hubs = nodes.filter(n => n.level === 'parts');
  if (hubs.length > 0) {
    const hubSizes = hubs.map(h => ({
      id: h.id,
      label: h.label,
      size: countDescendants(h.id, childrenOf),
    }));

    const avgSize = hubSizes.reduce((s, h) => s + h.size, 0) / hubSizes.length;

    for (const h of hubSizes) {
      if (h.size > avgSize * 3 && hubSizes.length > 2) {
        warnings.push(`Hub "${h.label}" has ${h.size} descendants (avg ${Math.round(avgSize)}) — consider splitting`);
      }
      if (h.size === 0) {
        warnings.push(`Hub "${h.label}" is empty`);
      }
    }
  }

  // ── Tier distribution ──

  const stCount = nodes.filter(n => n.tier === 'st' && n.level !== 'world').length;
  const ltCount = nodes.filter(n => n.tier === 'lt' && n.level !== 'world').length;
  const total = stCount + ltCount;
  if (total > 0 && stCount / total > 0.7) {
    warnings.push(`${Math.round(stCount / total * 100)}% of nodes are draft (st) — consider promoting stable nodes to lt`);
  }

  // ── Self-loops in cross-edges ──

  for (const e of crossEdges) {
    if (e.sourceAnchorId === e.targetAnchorId) {
      errors.push(`Self-loop edge "${e.id}" on "${e.sourceAnchorId}"`);
    }
  }

  // ── Report ──

  console.log('── Graph Integrity Report ──\n');
  console.log(`  Nodes: ${nodes.length}`);
  console.log(`  Cross-edges: ${crossEdges.length}`);
  console.log(`  Connected components: ${components.length}`);
  console.log(`  Hubs: ${hubs.length}`);

  if (warnings.length > 0) {
    console.log(`\n── Warnings (${warnings.length}) ──`);
    for (const w of warnings) console.log(`  WARN  ${w}`);
  }

  if (errors.length > 0) {
    console.log(`\n── Errors (${errors.length}) ──`);
    for (const e of errors) console.log(`  ERR   ${e}`);
    console.log('\nFAILED');
    process.exit(1);
  }

  console.log('\nPASSED');
}

function countDescendants(id: string, childrenOf: Map<string, string[]>): number {
  const children = childrenOf.get(id) ?? [];
  let count = children.length;
  for (const child of children) {
    count += countDescendants(child, childrenOf);
  }
  return count;
}

// ── Main ──

const seedArg = process.argv[2];
let seedPath = resolve(seedArg ?? 'map-viewer/src/seed.ts');

if (!existsSync(seedPath)) {
  const alt = resolve('scaffold/src/seed.ts');
  if (existsSync(alt)) seedPath = alt;
  else {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }
}

console.log(`Checking: ${seedPath}\n`);
checkIntegrity(seedPath).catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
