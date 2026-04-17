import { getDb } from '../db.js';
import type { MemoryNode, CrossEdge, TraversalResult, TraversalEdge } from '../types.js';

export interface TraverseOptions {
  maxDepth?: number;
  direction?: 'up' | 'down' | 'both';
  includeCrossEdges?: boolean;
  strategy?: 'bfs' | 'dfs';
  edgeTypeFilter?: string[];
}

export function traverse(startId: string, options: TraverseOptions = {}): TraversalResult {
  const db = getDb();
  const {
    maxDepth = 2,
    direction = 'both',
    includeCrossEdges = true,
    strategy = 'bfs',
    edgeTypeFilter,
  } = options;

  // Load all nodes and edges into memory (small corpus, fast)
  const allNodes = new Map<string, MemoryNode>();
  const rows = db.prepare('SELECT * FROM nodes').all() as Array<Record<string, unknown>>;
  for (const r of rows) {
    allNodes.set(r.id as string, {
      id: r.id as string,
      label: r.label as string,
      level: r.level as MemoryNode['level'],
      tier: r.tier as MemoryNode['tier'],
      parentId: r.parent_id as string | null,
      story: r.story as string | undefined,
      context: r.context as string | undefined,
      x: r.x as number,
      y: r.y as number,
    });
  }

  const allEdges: CrossEdge[] = [];
  if (includeCrossEdges) {
    const edgeRows = db.prepare('SELECT * FROM cross_edges').all() as Array<Record<string, unknown>>;
    for (const r of edgeRows) {
      const edge: CrossEdge = {
        id: r.id as string,
        sourceAnchorId: r.source_id as string,
        targetAnchorId: r.target_id as string,
        edgeType: r.edge_type as string,
        confidence: r.confidence as number,
      };
      if (edgeTypeFilter && !edgeTypeFilter.includes(edge.edgeType)) continue;
      allEdges.push(edge);
    }
  }

  // Build adjacency lists
  const adj = new Map<string, Array<{ targetId: string; edge: TraversalEdge }>>();

  const addAdj = (from: string, to: string, edge: TraversalEdge) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ targetId: to, edge });
  };

  // Hierarchy edges
  for (const node of allNodes.values()) {
    if (node.parentId && allNodes.has(node.parentId)) {
      if (direction === 'up' || direction === 'both') {
        addAdj(node.id, node.parentId, { from: node.id, to: node.parentId, type: 'hierarchy' });
      }
      if (direction === 'down' || direction === 'both') {
        addAdj(node.parentId, node.id, { from: node.parentId, to: node.id, type: 'hierarchy' });
      }
    }
  }

  // Cross-edges (bidirectional)
  for (const edge of allEdges) {
    addAdj(edge.sourceAnchorId, edge.targetAnchorId, {
      from: edge.sourceAnchorId,
      to: edge.targetAnchorId,
      type: 'cross-edge',
      edgeType: edge.edgeType,
    });
    addAdj(edge.targetAnchorId, edge.sourceAnchorId, {
      from: edge.targetAnchorId,
      to: edge.sourceAnchorId,
      type: 'cross-edge',
      edgeType: edge.edgeType,
    });
  }

  // BFS/DFS traversal
  const visited = new Map<string, MemoryNode>();
  const edges: TraversalEdge[] = [];
  let maxDepthReached = 0;

  if (strategy === 'bfs') {
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const seen = new Set<string>([startId]);

    const startNode = allNodes.get(startId);
    if (startNode) visited.set(startId, startNode);

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepthReached) maxDepthReached = depth;
      if (depth >= maxDepth) continue;

      const neighbors = adj.get(id) ?? [];
      for (const { targetId, edge } of neighbors) {
        if (!seen.has(targetId)) {
          seen.add(targetId);
          const node = allNodes.get(targetId);
          if (node) {
            visited.set(targetId, node);
            edges.push(edge);
            queue.push({ id: targetId, depth: depth + 1 });
          }
        }
      }
    }
  } else {
    // DFS
    const stack: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
    const seen = new Set<string>([startId]);

    const startNode = allNodes.get(startId);
    if (startNode) visited.set(startId, startNode);

    while (stack.length > 0) {
      const { id, depth } = stack.pop()!;
      if (depth > maxDepthReached) maxDepthReached = depth;
      if (depth >= maxDepth) continue;

      const neighbors = adj.get(id) ?? [];
      for (const { targetId, edge } of neighbors) {
        if (!seen.has(targetId)) {
          seen.add(targetId);
          const node = allNodes.get(targetId);
          if (node) {
            visited.set(targetId, node);
            edges.push(edge);
            stack.push({ id: targetId, depth: depth + 1 });
          }
        }
      }
    }
  }

  return {
    visited: Array.from(visited.values()),
    edges,
    depth: maxDepthReached,
  };
}
