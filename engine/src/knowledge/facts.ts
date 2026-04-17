import { getDb } from '../db.js';
import type { Fact } from '../types.js';

export interface AddFactOptions {
  validFrom?: string;
  source?: string;
}

export interface QueryFactOptions {
  direction?: 'outgoing' | 'incoming' | 'both';
  asOf?: string;
  predicate?: string;
}

export function addFact(
  subject: string,
  predicate: string,
  object: string,
  options: AddFactOptions = {},
): Fact {
  const db = getDb();
  const { validFrom, source } = options;

  const result = db.prepare(`
    INSERT INTO facts (subject, predicate, object, valid_from, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(subject, predicate, object, validFrom ?? null, source ?? null);

  return {
    id: result.lastInsertRowid as number,
    subject,
    predicate,
    object,
    validFrom: validFrom ?? null,
    validTo: null,
    source: source ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function queryFacts(entity: string, options: QueryFactOptions = {}): Fact[] {
  const db = getDb();
  const { direction = 'both', asOf, predicate } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (direction === 'outgoing') {
    conditions.push('subject = ?');
    params.push(entity);
  } else if (direction === 'incoming') {
    conditions.push('object = ?');
    params.push(entity);
  } else {
    conditions.push('(subject = ? OR object = ?)');
    params.push(entity, entity);
  }

  if (predicate) {
    conditions.push('predicate = ?');
    params.push(predicate);
  }

  if (asOf) {
    conditions.push('(valid_from IS NULL OR valid_from <= ?)');
    conditions.push('(valid_to IS NULL OR valid_to > ?)');
    params.push(asOf, asOf);
  }

  const sql = `
    SELECT id, subject, predicate, object, valid_from AS validFrom,
           valid_to AS validTo, source, created_at AS createdAt
    FROM facts
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
  `;

  return db.prepare(sql).all(...params) as Fact[];
}

export function invalidateFact(factId: number, validTo?: string): void {
  const db = getDb();
  const endDate = validTo ?? new Date().toISOString();
  db.prepare('UPDATE facts SET valid_to = ? WHERE id = ?').run(endDate, factId);
}

export function deleteFact(factId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM facts WHERE id = ?').run(factId);
}
