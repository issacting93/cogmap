import type { MemoryNode, CrossEdge } from '../types';
import { WORLD_NODE_ID } from '../constants';

interface P { x: number; y: number; vx: number; vy: number; }

/**
 * Force-directed layout for the map view.
 *
 * Forces:
 *  - Repulsion between every node (so nothing overlaps)
 *  - Hierarchy spring (parent ↔ child) — produces tight clusters per Part
 *  - Cross-edge spring (loose) — pulls semantically related nodes closer across clusters
 *  - Mild center gravity — keeps the composition contained
 *
 * Initial positions are deterministic (seeded by id hash) so the layout is
 * stable across renders.
 */
export function forceLayout(
  anchors: MemoryNode[],
  edges: CrossEdge[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (anchors.length === 0) return result;

  // Stable order so the layout is deterministic regardless of iteration order
  const sorted = [...anchors].sort((a, b) => a.id.localeCompare(b.id));
  const total = sorted.length;
  const pos = new Map<string, P>();

  // ── Init: spread on a unit circle with id-hash jitter ──
  sorted.forEach((a, i) => {
    let h = 5381;
    for (let k = 0; k < a.id.length; k++) h = ((h << 5) + h) + a.id.charCodeAt(k);
    h = Math.abs(h);
    const baseAngle = (i / total) * Math.PI * 2;
    const jitter = ((h % 1000) / 1000 - 0.5) * 0.5;
    const angle = baseAngle + jitter;
    const r = 3 + ((h % 100) / 100) * 1.5;
    pos.set(a.id, {
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      vx: 0, vy: 0,
    });
  });

  // ── Tunables (in world units) ──
  const REPULSION_K     = 0.55;  // strength of node-node repulsion
  const REPULSION_MIN   = 0.05;  // floor on distance² to prevent singularities
  const HIERARCHY_TARGET = 1.0;   // ideal parent↔child distance
  const HIERARCHY_K     = 0.18;
  const EDGE_TARGET     = 2.4;
  const EDGE_K          = 0.06;
  const CENTER_K        = 0.004;
  const DAMPING         = 0.55;
  const STEP            = 0.4;
  const ITERATIONS      = 250;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const cooling = 1 - (iter / ITERATIONS) * 0.4;

    // 1. Repulsion (n²)
    for (let i = 0; i < total; i++) {
      const a = pos.get(sorted[i].id)!;
      for (let j = i + 1; j < total; j++) {
        const b = pos.get(sorted[j].id)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = Math.max(dx * dx + dy * dy, REPULSION_MIN);
        const dist = Math.sqrt(distSq);
        const force = REPULSION_K / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // 2. Hierarchy attraction (parent springs hold children close)
    sorted.forEach(child => {
      if (!child.parentId || child.parentId === WORLD_NODE_ID) return;
      const c = pos.get(child.id);
      const p = pos.get(child.parentId);
      if (!c || !p) return;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist - HIERARCHY_TARGET) * HIERARCHY_K;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      c.vx += fx;        c.vy += fy;
      p.vx -= fx * 0.5;  p.vy -= fy * 0.5; // parents move half as much
    });

    // 3. Cross-edge attraction (looser spring; pulls related nodes together)
    edges.forEach(edge => {
      const a = pos.get(edge.sourceAnchorId);
      const b = pos.get(edge.targetAnchorId);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = (dist - EDGE_TARGET) * EDGE_K;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });

    // 4. Center gravity
    pos.forEach(p => {
      p.vx -= p.x * CENTER_K;
      p.vy -= p.y * CENTER_K;
    });

    // 5. Integrate
    pos.forEach(p => {
      p.x += p.vx * STEP * cooling;
      p.y += p.vy * STEP * cooling;
      p.vx *= DAMPING;
      p.vy *= DAMPING;
    });
  }

  pos.forEach((p, id) => result.set(id, { x: p.x, y: p.y }));
  return result;
}

/* ── Suggest connections via simple text similarity ───────────────────────── */

const STOP_WORDS = new Set([
  'this','that','with','from','have','will','been','were','they','them','their',
  'what','when','where','about','should','could','would','here','there','than',
  'then','also','some','more','very','just','like','only','your','because',
  'still','into','over','same','make','after','before','need','take','want',
  'going','plan','planning','semester','class','course','section',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .filter(w => !STOP_WORDS.has(w))
  );
}

function jaccard(t1: string, t2: string): number {
  const a = tokenize(t1);
  const b = tokenize(t2);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach(w => { if (b.has(w)) inter++; });
  return inter / (a.size + b.size - inter);
}

export interface ConnectionSuggestion {
  sourceId: string;
  targetId: string;
  similarity: number;
}

/**
 * Suggest CrossEdges based on label + story text similarity.
 * Skips pairs that are already structurally connected (parent/child) or
 * already linked by an existing CrossEdge.
 */
export function suggestConnections(
  anchors: MemoryNode[],
  edges: CrossEdge[],
  threshold = 0.15,
): ConnectionSuggestion[] {
  const existing = new Set<string>();
  edges.forEach(e => {
    existing.add(`${e.sourceAnchorId}|${e.targetAnchorId}`);
    existing.add(`${e.targetAnchorId}|${e.sourceAnchorId}`);
  });

  const out: ConnectionSuggestion[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    for (let j = i + 1; j < anchors.length; j++) {
      const b = anchors[j];
      if (a.parentId === b.id || b.parentId === a.id) continue;
      if (existing.has(`${a.id}|${b.id}`)) continue;
      const sim = jaccard(
        `${a.label} ${a.story ?? ''}`,
        `${b.label} ${b.story ?? ''}`,
      );
      if (sim >= threshold) {
        out.push({ sourceId: a.id, targetId: b.id, similarity: sim });
      }
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}
