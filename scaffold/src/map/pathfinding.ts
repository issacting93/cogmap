/**
 * BFS pathfinding across hierarchy edges + cross-edges.
 * Returns the shortest path (by hop count) between two nodes.
 */
import type { MemoryNode, CrossEdge } from '../types';
import { WORLD_NODE_ID } from '../constants';

export interface PathStep {
  nodeId: string;
  edgeType: 'hierarchy' | 'cross-edge';
  edgeLabel?: string; // e.g. "OPERATIONALIZES"
}

export interface PathResult {
  found: boolean;
  /** Ordered node IDs from `from` to `to` (inclusive). Empty if not found. */
  path: string[];
  /** Step details for the route panel */
  steps: PathStep[];
}

/**
 * Build an adjacency list that includes both hierarchy (parent/child)
 * and cross-edge connections.
 */
function buildAdjacency(
  nodes: MemoryNode[],
  crossEdges: CrossEdge[],
): Map<string, Array<{ target: string; type: 'hierarchy' | 'cross-edge'; label?: string }>> {
  const adj = new Map<string, Array<{ target: string; type: 'hierarchy' | 'cross-edge'; label?: string }>>();

  const ensure = (id: string) => {
    if (!adj.has(id)) adj.set(id, []);
  };

  // Hierarchy edges (bidirectional: parent ↔ child)
  for (const node of nodes) {
    ensure(node.id);
    if (node.parentId && node.parentId !== WORLD_NODE_ID) {
      ensure(node.parentId);
      adj.get(node.id)!.push({ target: node.parentId, type: 'hierarchy' });
      adj.get(node.parentId)!.push({ target: node.id, type: 'hierarchy' });
    }
  }

  // Cross-edges (bidirectional)
  for (const edge of crossEdges) {
    ensure(edge.sourceAnchorId);
    ensure(edge.targetAnchorId);
    adj.get(edge.sourceAnchorId)!.push({ target: edge.targetAnchorId, type: 'cross-edge', label: edge.edgeType });
    adj.get(edge.targetAnchorId)!.push({ target: edge.sourceAnchorId, type: 'cross-edge', label: edge.edgeType });
  }

  return adj;
}

/**
 * BFS shortest path from `fromId` to `toId`.
 */
export function findPath(
  nodes: MemoryNode[],
  crossEdges: CrossEdge[],
  fromId: string,
  toId: string,
): PathResult {
  if (fromId === toId) {
    return { found: true, path: [fromId], steps: [{ nodeId: fromId, edgeType: 'hierarchy' }] };
  }

  const adj = buildAdjacency(nodes, crossEdges);
  if (!adj.has(fromId) || !adj.has(toId)) {
    return { found: false, path: [], steps: [] };
  }

  // BFS — index-based queue to avoid O(n) shift()
  const visited = new Set<string>([fromId]);
  const prev = new Map<string, { from: string; type: 'hierarchy' | 'cross-edge'; label?: string }>();
  const queue: string[] = [fromId];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    if (current === toId) break;

    for (const neighbor of adj.get(current) ?? []) {
      if (visited.has(neighbor.target)) continue;
      visited.add(neighbor.target);
      prev.set(neighbor.target, { from: current, type: neighbor.type, label: neighbor.label });
      queue.push(neighbor.target);
    }
  }

  if (!prev.has(toId)) {
    return { found: false, path: [], steps: [] };
  }

  // Reconstruct path
  const path: string[] = [];
  const steps: PathStep[] = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur)!;
    path.unshift(cur);
    steps.unshift({ nodeId: cur, edgeType: p.type, edgeLabel: p.label });
    cur = p.from;
  }
  path.unshift(fromId);
  steps.unshift({ nodeId: fromId, edgeType: 'hierarchy' });

  return { found: true, path, steps };
}
