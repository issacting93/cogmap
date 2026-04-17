import { getDb } from '../db.js';
import type { MemoryNode, SemanticResult } from '../types.js';

// ── Stop words (shared with viewer's mapForceLayout.ts) ──

const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'will', 'been', 'were', 'they',
  'them', 'their', 'what', 'when', 'where', 'about', 'should', 'could',
  'would', 'here', 'there', 'than', 'then', 'also', 'some', 'more', 'very',
  'just', 'like', 'only', 'your', 'because', 'still', 'into', 'over',
  'same', 'make', 'after', 'before', 'need', 'take', 'want', 'each',
  'does', 'done', 'doing', 'which', 'while', 'being', 'such',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// ── TF-IDF Engine ──

interface DocVector {
  nodeId: string;
  label: string;
  tfidf: Map<string, number>;
  magnitude: number;
}

let corpus: DocVector[] = [];
let idfMap: Map<string, number> = new Map();
let built = false;

export function buildVectors(nodes: MemoryNode[]): void {
  const docCount = nodes.length;
  if (docCount === 0) return;

  // Document frequency: how many docs contain each term
  const df = new Map<string, number>();
  const docTerms: Map<string, number>[] = [];

  for (const node of nodes) {
    const text = `${node.label} ${node.story ?? ''} ${node.context ?? ''}`;
    const tokens = tokenize(text);
    const tf = new Map<string, number>();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // Track document frequency
    for (const term of tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }

    docTerms.push(tf);
  }

  // Compute IDF
  idfMap = new Map();
  for (const [term, count] of df) {
    idfMap.set(term, Math.log(docCount / count));
  }

  // Build TF-IDF vectors
  corpus = nodes.map((node, i) => {
    const tf = docTerms[i];
    const tfidf = new Map<string, number>();
    let magSq = 0;

    for (const [term, count] of tf) {
      const idf = idfMap.get(term) ?? 0;
      const score = count * idf;
      tfidf.set(term, score);
      magSq += score * score;
    }

    return {
      nodeId: node.id,
      label: node.label,
      tfidf,
      magnitude: Math.sqrt(magSq),
    };
  });

  // Store vectors in SQLite for persistence
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT OR REPLACE INTO embeddings (node_id, vector, computed_at) VALUES (?, ?, ?)'
  );

  const tx = db.transaction(() => {
    for (const doc of corpus) {
      const obj = Object.fromEntries(doc.tfidf);
      insert.run(doc.nodeId, JSON.stringify(obj), now);
    }
  });
  tx();

  built = true;
}

function cosineSimilarity(a: Map<string, number>, aMag: number, b: Map<string, number>, bMag: number): number {
  if (aMag === 0 || bMag === 0) return 0;

  let dot = 0;
  // Iterate over the smaller map
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [term, score] of smaller) {
    const otherScore = larger.get(term);
    if (otherScore !== undefined) {
      dot += score * otherScore;
    }
  }

  return dot / (aMag * bMag);
}

function queryToVector(query: string): { tfidf: Map<string, number>; magnitude: number } {
  const tokens = tokenize(query);
  const tf = new Map<string, number>();

  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const tfidf = new Map<string, number>();
  let magSq = 0;

  for (const [term, count] of tf) {
    const idf = idfMap.get(term) ?? 0;
    const score = count * idf;
    if (score > 0) {
      tfidf.set(term, score);
      magSq += score * score;
    }
  }

  return { tfidf, magnitude: Math.sqrt(magSq) };
}

export function semanticSearch(query: string, limit = 10): SemanticResult[] {
  if (!built || corpus.length === 0) return [];

  const qv = queryToVector(query);
  if (qv.magnitude === 0) return [];

  const results: SemanticResult[] = [];

  for (const doc of corpus) {
    const similarity = cosineSimilarity(qv.tfidf, qv.magnitude, doc.tfidf, doc.magnitude);
    if (similarity > 0) {
      results.push({
        nodeId: doc.nodeId,
        label: doc.label,
        similarity,
      });
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function findSimilar(nodeId: string, limit = 5): SemanticResult[] {
  if (!built) return [];

  const target = corpus.find(d => d.nodeId === nodeId);
  if (!target) return [];

  const results: SemanticResult[] = [];

  for (const doc of corpus) {
    if (doc.nodeId === nodeId) continue;
    const similarity = cosineSimilarity(target.tfidf, target.magnitude, doc.tfidf, doc.magnitude);
    if (similarity > 0) {
      results.push({
        nodeId: doc.nodeId,
        label: doc.label,
        similarity,
      });
    }
  }

  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function isBuilt(): boolean {
  return built;
}
