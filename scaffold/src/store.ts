import { create } from 'zustand';
import type { MemoryNode, CrossEdge } from './types';
import { nodes as seedNodes, crossEdges as seedEdges } from './seed';

interface AppState {
  anchors: MemoryNode[];
  crossEdges: CrossEdge[];
  activeConversationId: string | null;

  addAnchor: (data: Omit<MemoryNode, 'id'>) => string;
  updateAnchor: (id: string, patch: Partial<MemoryNode>) => void;
  removeAnchor: (id: string) => void;
  promoteAnchor: (id: string) => void;
  demoteAnchor: (id: string) => void;
  addCrossEdge: (data: Omit<CrossEdge, 'id'>) => void;
  updateCrossEdge: (id: string, patch: Partial<CrossEdge>) => void;
  removeCrossEdge: (id: string) => void;
}

let _counter = 1000;

export const useAppStore = create<AppState>((set) => ({
  anchors: seedNodes,
  crossEdges: seedEdges,
  activeConversationId: 'cogmap-session',

  addAnchor: (data) => {
    const id = `node_${++_counter}`;
    const node: MemoryNode = { ...data, id };
    set((s) => ({ anchors: [...s.anchors, node] }));
    return id;
  },

  updateAnchor: (id, patch) => {
    set((s) => ({
      anchors: s.anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  },

  removeAnchor: (id) => {
    set((s) => ({
      anchors: s.anchors.filter((a) => a.id !== id && a.parentId !== id),
      crossEdges: s.crossEdges.filter(
        (e) => e.sourceAnchorId !== id && e.targetAnchorId !== id,
      ),
    }));
  },

  promoteAnchor: (id) => {
    set((s) => ({
      anchors: s.anchors.map((a) =>
        a.id === id ? { ...a, tier: 'lt' as const } : a,
      ),
    }));
  },

  demoteAnchor: (id) => {
    set((s) => ({
      anchors: s.anchors.map((a) =>
        a.id === id ? { ...a, tier: 'st' as const } : a,
      ),
    }));
  },

  addCrossEdge: (data) => {
    const id = `xe_${++_counter}`;
    set((s) => ({ crossEdges: [...s.crossEdges, { ...data, id }] }));
  },

  updateCrossEdge: (id, patch) => {
    set((s) => ({
      crossEdges: s.crossEdges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  },

  removeCrossEdge: (id) => {
    set((s) => ({
      crossEdges: s.crossEdges.filter((e) => e.id !== id),
    }));
  },
}));
