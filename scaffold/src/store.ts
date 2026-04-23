import { create } from 'zustand';
import type { MemoryNode, CrossEdge } from './types';
import { nodes as seedNodes, crossEdges as seedEdges } from './seed';

/* ── History ─────────────────────────────────────────────────────────────────── */

interface Snapshot {
  anchors: MemoryNode[];
  crossEdges: CrossEdge[];
}

const MAX_HISTORY = 50;
let _past: Snapshot[] = [];
let _future: Snapshot[] = [];
let _savedHash = hashOf(seedNodes, seedEdges);
let _counter = 1000;

function hashOf(anchors: MemoryNode[], crossEdges: CrossEdge[]): string {
  return JSON.stringify({ a: anchors, e: crossEdges });
}

function snap(anchors: MemoryNode[], crossEdges: CrossEdge[]): Snapshot {
  return { anchors: [...anchors], crossEdges: [...crossEdges] };
}

function pushHistory(anchors: MemoryNode[], crossEdges: CrossEdge[]) {
  _past.push(snap(anchors, crossEdges));
  if (_past.length > MAX_HISTORY) _past.shift();
  _future = [];
}

/* ── Store ────────────────────────────────────────────────────────────────── */

interface AppState {
  anchors: MemoryNode[];
  crossEdges: CrossEdge[];

  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;

  addAnchor: (data: Omit<MemoryNode, 'id'>) => string;
  updateAnchor: (id: string, patch: Partial<MemoryNode>) => void;
  removeAnchor: (id: string) => void;
  promoteAnchor: (id: string) => void;
  demoteAnchor: (id: string) => void;
  addCrossEdge: (data: Omit<CrossEdge, 'id'>) => void;
  updateCrossEdge: (id: string, patch: Partial<CrossEdge>) => void;
  removeCrossEdge: (id: string) => void;
  undo: () => void;
  redo: () => void;
  saveSeed: (positions?: Map<string, { x: number; y: number }>) => Promise<boolean>;
}

export const useAppStore = create<AppState>((set, get) => {

  /** Apply a mutation: snapshot current state, compute new state, update flags. */
  function mutate(fn: (s: AppState) => { anchors?: MemoryNode[]; crossEdges?: CrossEdge[] }) {
    const s = get();
    pushHistory(s.anchors, s.crossEdges);
    const patch = fn(s);
    const newAnchors = patch.anchors ?? s.anchors;
    const newEdges = patch.crossEdges ?? s.crossEdges;
    set({
      anchors: newAnchors,
      crossEdges: newEdges,
      canUndo: true,
      canRedo: false,
      isDirty: hashOf(newAnchors, newEdges) !== _savedHash,
    });
  }

  return {
    anchors: seedNodes,
    crossEdges: seedEdges,
    isDirty: false,
    canUndo: false,
    canRedo: false,

    addAnchor: (data) => {
      const id = `node_${++_counter}`;
      mutate((s) => ({ anchors: [...s.anchors, { ...data, id }] }));
      return id;
    },

    updateAnchor: (id, patch) => {
      mutate((s) => ({
        anchors: s.anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },

    removeAnchor: (id) => {
      mutate((s) => ({
        anchors: s.anchors.filter((a) => a.id !== id && a.parentId !== id),
        crossEdges: s.crossEdges.filter(
          (e) => e.sourceAnchorId !== id && e.targetAnchorId !== id,
        ),
      }));
    },

    promoteAnchor: (id) => {
      mutate((s) => ({
        anchors: s.anchors.map((a) =>
          a.id === id ? { ...a, tier: 'lt' as const } : a,
        ),
      }));
    },

    demoteAnchor: (id) => {
      mutate((s) => ({
        anchors: s.anchors.map((a) =>
          a.id === id ? { ...a, tier: 'st' as const } : a,
        ),
      }));
    },

    addCrossEdge: (data) => {
      const id = `xe_${++_counter}`;
      mutate((s) => ({ crossEdges: [...s.crossEdges, { ...data, id }] }));
    },

    updateCrossEdge: (id, patch) => {
      mutate((s) => ({
        crossEdges: s.crossEdges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      }));
    },

    removeCrossEdge: (id) => {
      mutate((s) => ({
        crossEdges: s.crossEdges.filter((e) => e.id !== id),
      }));
    },

    undo: () => {
      if (_past.length === 0) return;
      const s = get();
      _future.push(snap(s.anchors, s.crossEdges));
      const prev = _past.pop()!;
      set({
        anchors: prev.anchors,
        crossEdges: prev.crossEdges,
        canUndo: _past.length > 0,
        canRedo: true,
        isDirty: hashOf(prev.anchors, prev.crossEdges) !== _savedHash,
      });
    },

    redo: () => {
      if (_future.length === 0) return;
      const s = get();
      _past.push(snap(s.anchors, s.crossEdges));
      const next = _future.pop()!;
      set({
        anchors: next.anchors,
        crossEdges: next.crossEdges,
        canUndo: true,
        canRedo: _future.length > 0,
        isDirty: hashOf(next.anchors, next.crossEdges) !== _savedHash,
      });
    },

    saveSeed: async (positions) => {
      const s = get();
      let anchors = s.anchors;

      // Bake force-layout positions into node data so the layout is stable on reload
      if (positions) {
        anchors = anchors.map((a) => {
          const p = positions.get(a.id);
          return p ? { ...a, x: Math.round(p.x), y: Math.round(p.y) } : a;
        });
      }

      try {
        const res = await fetch('/api/save-seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes: anchors, crossEdges: s.crossEdges }),
        });
        if (!res.ok) return false;

        _savedHash = hashOf(anchors, s.crossEdges);
        set({ anchors, isDirty: false });
        return true;
      } catch {
        return false;
      }
    },
  };
});
