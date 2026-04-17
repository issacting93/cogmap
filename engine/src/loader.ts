import { getDb } from './db.js';
import { resolve } from 'path';
import { watch, existsSync } from 'fs';
import type { MemoryNode, CrossEdge } from './types.js';

export interface LoadResult {
  nodes: MemoryNode[];
  crossEdges: CrossEdge[];
  loadedAt: string;
}

// In-memory cache of current map data
let currentData: LoadResult | null = null;

export function getCurrentData(): LoadResult | null {
  return currentData;
}

export async function loadSeed(seedPath: string): Promise<LoadResult> {
  const absPath = resolve(seedPath);
  if (!existsSync(absPath)) {
    throw new Error(`Seed file not found: ${absPath}`);
  }

  // Dynamic import with cache-busting query param for reloads
  const mod = await import(`${absPath}?t=${Date.now()}`);
  const nodes: MemoryNode[] = mod.nodes ?? [];
  const crossEdges: CrossEdge[] = mod.crossEdges ?? [];
  const loadedAt = new Date().toISOString();

  const result: LoadResult = { nodes, crossEdges, loadedAt };
  populateDb(result);
  currentData = result;
  return result;
}

function populateDb(data: LoadResult): void {
  const db = getDb();
  const { nodes, crossEdges, loadedAt } = data;

  // Detect changes against existing data for changelog
  const existingNodes = new Map<string, Record<string, unknown>>();
  const rows = db.prepare('SELECT * FROM nodes').all() as Record<string, unknown>[];
  for (const row of rows) {
    existingNodes.set(row.id as string, row);
  }

  db.exec('BEGIN TRANSACTION');
  try {
    // Record changelog entries
    const existingIds = new Set(existingNodes.keys());
    const newIds = new Set(nodes.map(n => n.id));

    // Removed nodes
    for (const id of existingIds) {
      if (!newIds.has(id)) {
        db.prepare(
          'INSERT INTO changelog (node_id, change_type, detected_at) VALUES (?, ?, ?)'
        ).run(id, 'removed', loadedAt);
      }
    }

    // Added and modified nodes
    for (const node of nodes) {
      const existing = existingNodes.get(node.id);
      if (!existing) {
        db.prepare(
          'INSERT INTO changelog (node_id, change_type, detected_at) VALUES (?, ?, ?)'
        ).run(node.id, 'added', loadedAt);
      } else {
        // Check for modifications
        const fields = ['label', 'level', 'tier', 'story', 'context'] as const;
        for (const field of fields) {
          const dbField = field === 'story' ? 'story' : field === 'context' ? 'context' : field;
          const oldVal = String(existing[dbField] ?? '');
          const newVal = String(node[field] ?? '');
          if (oldVal !== newVal) {
            db.prepare(
              'INSERT INTO changelog (node_id, change_type, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(node.id, 'modified', field, oldVal || null, newVal || null, loadedAt);
          }
        }
      }
    }

    // Clear and repopulate nodes
    db.exec('DELETE FROM nodes');
    db.exec('DELETE FROM nodes_fts');
    db.exec('DELETE FROM cross_edges');

    const insertNode = db.prepare(`
      INSERT INTO nodes (id, label, level, tier, parent_id, story, context, x, y, loaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = db.prepare(`
      INSERT INTO nodes_fts (rowid, id, label, story, context)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      insertNode.run(n.id, n.label, n.level, n.tier, n.parentId, n.story ?? null, n.context ?? null, n.x, n.y, loadedAt);
      insertFts.run(i + 1, n.id, n.label, n.story ?? '', n.context ?? '');
    }

    const insertEdge = db.prepare(`
      INSERT INTO cross_edges (id, source_id, target_id, edge_type, confidence)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const e of crossEdges) {
      insertEdge.run(e.id, e.sourceAnchorId, e.targetAnchorId, e.edgeType, e.confidence);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function watchSeed(seedPath: string, onChange: (result: LoadResult) => void): void {
  const absPath = resolve(seedPath);
  let debounce: ReturnType<typeof setTimeout> | null = null;

  watch(absPath, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const result = await loadSeed(seedPath);
        onChange(result);
      } catch (err) {
        console.error('[cogmap-engine] Seed reload failed:', err);
      }
    }, 500);
  });
}
