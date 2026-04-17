import { getDb } from '../db.js';
import type { SearchResult, MemoryLevel, MemoryTier } from '../types.js';

export interface SearchOptions {
  level?: MemoryLevel;
  tier?: MemoryTier;
  hubId?: string;
  limit?: number;
}

export function searchNodes(query: string, options: SearchOptions = {}): SearchResult[] {
  const db = getDb();
  const { level, tier, hubId, limit = 10 } = options;

  // FTS5 query — wrap each token in quotes for prefix matching
  const ftsQuery = query
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => `"${w}"*`)
    .join(' OR ');

  if (!ftsQuery) return [];

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (level) {
    conditions.push('n.level = ?');
    params.push(level);
  }
  if (tier) {
    conditions.push('n.tier = ?');
    params.push(tier);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  // Query with BM25 ranking
  let sql: string;
  if (hubId) {
    // Filter to nodes under a specific hub (need recursive parent walk)
    sql = `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
      )
      SELECT
        n.id AS nodeId,
        n.label,
        n.level,
        n.tier,
        snippet(nodes_fts, 2, '»', '«', '…', 32) AS snippet,
        rank AS rank,
        CASE
          WHEN nodes_fts.label MATCH ? THEN 'label'
          WHEN nodes_fts.story MATCH ? THEN 'story'
          ELSE 'context'
        END AS matchField
      FROM nodes_fts
      JOIN nodes n ON n.id = nodes_fts.id
      WHERE nodes_fts MATCH ?
        AND n.id IN (SELECT id FROM descendants)
        ${whereClause}
      ORDER BY rank
      LIMIT ?
    `;
    params.unshift(hubId);
    params.push(ftsQuery, ftsQuery, ftsQuery);
  } else {
    sql = `
      SELECT
        n.id AS nodeId,
        n.label,
        n.level,
        n.tier,
        snippet(nodes_fts, 2, '»', '«', '…', 32) AS snippet,
        rank AS rank,
        CASE
          WHEN nodes_fts.label MATCH ? THEN 'label'
          WHEN nodes_fts.story MATCH ? THEN 'story'
          ELSE 'context'
        END AS matchField
      FROM nodes_fts
      JOIN nodes n ON n.id = nodes_fts.id
      WHERE nodes_fts MATCH ?
        ${whereClause}
      ORDER BY rank
      LIMIT ?
    `;
    params.unshift(ftsQuery, ftsQuery, ftsQuery);
  }

  params.push(limit);

  try {
    const rows = db.prepare(sql).all(...params) as SearchResult[];
    return rows;
  } catch {
    // FTS query syntax error — fall back to LIKE search
    return fallbackSearch(query, options);
  }
}

function fallbackSearch(query: string, options: SearchOptions): SearchResult[] {
  const db = getDb();
  const { level, tier, limit = 10 } = options;
  const pattern = `%${query}%`;

  const conditions: string[] = ['(label LIKE ? OR story LIKE ? OR context LIKE ?)'];
  const params: unknown[] = [pattern, pattern, pattern];

  if (level) {
    conditions.push('level = ?');
    params.push(level);
  }
  if (tier) {
    conditions.push('tier = ?');
    params.push(tier);
  }

  params.push(limit);

  const sql = `
    SELECT
      id AS nodeId, label, level, tier,
      COALESCE(story, context, label) AS snippet,
      0 AS rank,
      'label' AS matchField
    FROM nodes
    WHERE ${conditions.join(' AND ')}
    LIMIT ?
  `;

  return db.prepare(sql).all(...params) as SearchResult[];
}
