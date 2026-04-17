import { getDb } from '../db.js';
import type { Fact, ChangelogEntry } from '../types.js';

export function getTimeline(entity?: string): Array<Fact & { isCurrent: boolean }> {
  const db = getDb();
  const now = new Date().toISOString();

  let sql: string;
  const params: unknown[] = [];

  if (entity) {
    sql = `
      SELECT id, subject, predicate, object, valid_from AS validFrom,
             valid_to AS validTo, source, created_at AS createdAt
      FROM facts
      WHERE subject = ? OR object = ?
      ORDER BY created_at ASC
    `;
    params.push(entity, entity);
  } else {
    sql = `
      SELECT id, subject, predicate, object, valid_from AS validFrom,
             valid_to AS validTo, source, created_at AS createdAt
      FROM facts
      ORDER BY created_at ASC
    `;
  }

  const rows = db.prepare(sql).all(...params) as Fact[];

  return rows.map(fact => ({
    ...fact,
    isCurrent: !fact.validTo || fact.validTo > now,
  }));
}

export function getNodeHistory(nodeId: string): ChangelogEntry[] {
  const db = getDb();

  return db.prepare(`
    SELECT id, node_id AS nodeId, change_type AS changeType,
           field, old_value AS oldValue, new_value AS newValue,
           detected_at AS detectedAt
    FROM changelog
    WHERE node_id = ?
    ORDER BY detected_at ASC
  `).all(nodeId) as ChangelogEntry[];
}

export function getRecentChanges(limit = 20): ChangelogEntry[] {
  const db = getDb();

  return db.prepare(`
    SELECT id, node_id AS nodeId, change_type AS changeType,
           field, old_value AS oldValue, new_value AS newValue,
           detected_at AS detectedAt
    FROM changelog
    ORDER BY detected_at DESC
    LIMIT ?
  `).all(limit) as ChangelogEntry[];
}
