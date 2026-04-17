import { getDb } from '../db.js';
import type { MemoryNode, CrossEdge } from '../types.js';

interface Subgraph {
  nodes: MemoryNode[];
  edges: CrossEdge[];
}

function rowToNode(r: Record<string, unknown>): MemoryNode {
  return {
    id: r.id as string,
    label: r.label as string,
    level: r.level as MemoryNode['level'],
    tier: r.tier as MemoryNode['tier'],
    parentId: r.parent_id as string | null,
    story: r.story as string | undefined,
    context: r.context as string | undefined,
    x: r.x as number,
    y: r.y as number,
  };
}

function rowToEdge(r: Record<string, unknown>): CrossEdge {
  return {
    id: r.id as string,
    sourceAnchorId: r.source_id as string,
    targetAnchorId: r.target_id as string,
    edgeType: r.edge_type as string,
    confidence: r.confidence as number,
  };
}

/**
 * Get all nodes and edges under a specific hub (parts-level node).
 */
export function getHubSubgraph(hubId: string): Subgraph {
  const db = getDb();

  // Recursive CTE to get all descendants
  const nodeRows = db.prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM nodes WHERE id = ?
      UNION ALL
      SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
    )
    SELECT n.* FROM nodes n WHERE n.id IN (SELECT id FROM descendants)
  `).all(hubId) as Array<Record<string, unknown>>;

  const nodes = nodeRows.map(rowToNode);
  const nodeIds = new Set(nodes.map(n => n.id));

  // Get cross-edges where at least one endpoint is in this subgraph
  const edgeRows = db.prepare(`
    SELECT * FROM cross_edges
    WHERE source_id IN (${Array.from(nodeIds).map(() => '?').join(',')})
       OR target_id IN (${Array.from(nodeIds).map(() => '?').join(',')})
  `).all(...Array.from(nodeIds), ...Array.from(nodeIds)) as Array<Record<string, unknown>>;

  return {
    nodes,
    edges: edgeRows.map(rowToEdge),
  };
}

/**
 * Get the neighborhood around a node — the node itself plus all nodes
 * reachable within `radius` hops via hierarchy or cross-edges.
 */
export function getNeighborhood(nodeId: string, radius = 1): Subgraph {
  const db = getDb();

  // Load all nodes and edges
  const allNodes = new Map<string, MemoryNode>();
  const rows = db.prepare('SELECT * FROM nodes').all() as Array<Record<string, unknown>>;
  for (const r of rows) {
    allNodes.set(r.id as string, rowToNode(r));
  }

  const allEdges = db.prepare('SELECT * FROM cross_edges').all() as Array<Record<string, unknown>>;
  const crossEdges = allEdges.map(rowToEdge);

  // Build adjacency (hierarchy + cross-edges, bidirectional)
  const adj = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  for (const node of allNodes.values()) {
    if (node.parentId && allNodes.has(node.parentId)) {
      addAdj(node.id, node.parentId);
    }
  }
  for (const edge of crossEdges) {
    addAdj(edge.sourceAnchorId, edge.targetAnchorId);
  }

  // BFS from nodeId up to radius
  const visited = new Set<string>([nodeId]);
  let frontier = [nodeId];

  for (let d = 0; d < radius; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  const nodes = Array.from(visited)
    .map(id => allNodes.get(id))
    .filter((n): n is MemoryNode => n !== undefined);

  // Include edges where both endpoints are in the neighborhood
  const edges = crossEdges.filter(
    e => visited.has(e.sourceAnchorId) && visited.has(e.targetAnchorId)
  );

  return { nodes, edges };
}

/**
 * Find all paths between two nodes (up to maxDepth).
 */
export function findPaths(fromId: string, toId: string, maxDepth = 5): string[][] {
  const db = getDb();

  const allNodes = new Set<string>();
  const rows = db.prepare('SELECT id, parent_id FROM nodes').all() as Array<{ id: string; parent_id: string | null }>;

  const adj = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  for (const r of rows) {
    allNodes.add(r.id);
    if (r.parent_id) addAdj(r.id, r.parent_id);
  }

  const edgeRows = db.prepare('SELECT source_id, target_id FROM cross_edges').all() as Array<{ source_id: string; target_id: string }>;
  for (const e of edgeRows) {
    addAdj(e.source_id, e.target_id);
  }

  // DFS to find all paths
  const paths: string[][] = [];

  function dfs(current: string, target: string, visited: Set<string>, path: string[]): void {
    if (path.length > maxDepth) return;
    if (current === target) {
      paths.push([...path]);
      return;
    }

    for (const neighbor of adj.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        path.push(neighbor);
        dfs(neighbor, target, visited, path);
        path.pop();
        visited.delete(neighbor);
      }
    }
  }

  const visited = new Set<string>([fromId]);
  dfs(fromId, toId, visited, [fromId]);

  return paths.sort((a, b) => a.length - b.length);
}
