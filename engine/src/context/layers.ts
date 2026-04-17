import { getDb } from '../db.js';
import { searchNodes } from '../search/text-search.js';
import { semanticSearch } from '../search/semantic.js';
import { getNeighborhood } from '../graph/subgraph.js';
import { queryFacts } from '../knowledge/facts.js';
import { estimateTokens, summarizeNode, prioritizeNodes } from './budget.js';
import type { MemoryNode, CrossEdge, ContextLayer, AssembledContext } from '../types.js';

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

/**
 * Layer 0: Project identity (~100 tokens)
 * Always loaded. Project name, structure summary, last update.
 */
export function getIdentityLayer(): ContextLayer {
  const db = getDb();

  const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number }).c;
  const edgeCount = (db.prepare('SELECT COUNT(*) AS c FROM cross_edges').get() as { c: number }).c;
  const factCount = (db.prepare('SELECT COUNT(*) AS c FROM facts WHERE valid_to IS NULL').get() as { c: number }).c;

  const hubs = db.prepare("SELECT label FROM nodes WHERE level = 'parts' ORDER BY label").all() as Array<{ label: string }>;
  const hubList = hubs.map(h => h.label).join(', ');

  const tierCounts = db.prepare(`
    SELECT tier, COUNT(*) AS c FROM nodes WHERE level != 'world' GROUP BY tier
  `).all() as Array<{ tier: string; c: number }>;
  const anchored = tierCounts.find(t => t.tier === 'lt')?.c ?? 0;
  const draft = tierCounts.find(t => t.tier === 'st')?.c ?? 0;

  const content = [
    `# Cognitive Map`,
    `Nodes: ${nodeCount} | Edges: ${edgeCount} | Active facts: ${factCount}`,
    `Hubs: ${hubList}`,
    `Status: ${anchored} anchored, ${draft} draft`,
  ].join('\n');

  return {
    layerId: 0,
    name: 'identity',
    tokenBudget: 100,
    content,
  };
}

/**
 * Layer 1: Hub summary (~500-800 tokens)
 * Top-level structure with child counts and key cross-edges.
 */
export function getHubSummaryLayer(): ContextLayer {
  const db = getDb();

  const hubs = db.prepare(`
    SELECT * FROM nodes WHERE level = 'parts' ORDER BY label
  `).all() as Array<Record<string, unknown>>;

  const lines: string[] = ['# Map Structure\n'];

  for (const hub of hubs) {
    const node = rowToNode(hub);
    const tierLabel = node.tier === 'lt' ? 'anchored' : 'draft';

    // Count descendants
    const descendants = db.prepare(`
      WITH RECURSIVE desc(id) AS (
        SELECT id FROM nodes WHERE parent_id = ?
        UNION ALL
        SELECT n.id FROM nodes n JOIN desc d ON n.parent_id = d.id
      )
      SELECT COUNT(*) AS c FROM desc
    `).get(node.id) as { c: number };

    lines.push(`## ${node.label} [${tierLabel}]`);
    if (node.story) lines.push(node.story);
    lines.push(`${descendants.c} child nodes`);

    // Key aspects under this hub
    const aspects = db.prepare(`
      SELECT label, tier, story FROM nodes WHERE parent_id = ? AND level = 'aspects'
    `).all(node.id) as Array<{ label: string; tier: string; story: string | null }>;

    if (aspects.length > 0) {
      for (const a of aspects) {
        const mark = a.tier === 'lt' ? '' : ' (draft)';
        lines.push(`  - ${a.label}${mark}`);
      }
    }

    // Cross-edges from this hub's subtree
    const edgesOut = db.prepare(`
      WITH RECURSIVE desc(id) AS (
        SELECT id FROM nodes WHERE id = ?
        UNION ALL
        SELECT n.id FROM nodes n JOIN desc d ON n.parent_id = d.id
      )
      SELECT DISTINCT ce.edge_type, n2.label AS target_label
      FROM cross_edges ce
      JOIN desc d ON ce.source_id = d.id
      JOIN nodes n2 ON ce.target_id = n2.id
      WHERE n2.id NOT IN (SELECT id FROM desc)
      LIMIT 5
    `).all(node.id) as Array<{ edge_type: string; target_label: string }>;

    if (edgesOut.length > 0) {
      lines.push(`  Links: ${edgesOut.map(e => `${e.edge_type} → ${e.target_label}`).join(', ')}`);
    }

    lines.push('');
  }

  const content = lines.join('\n');
  return {
    layerId: 1,
    name: 'hub-summary',
    tokenBudget: 800,
    content,
  };
}

/**
 * Layer 2: On-demand subgraph (~200-500 tokens)
 * Nodes and edges relevant to a specific topic/query.
 */
export function getSubgraphLayer(topic: string, options: { hubFilter?: string; maxNodes?: number } = {}): ContextLayer {
  const { hubFilter, maxNodes = 15 } = options;

  // Combine FTS and semantic results
  const ftsResults = searchNodes(topic, { hubId: hubFilter, limit: maxNodes });
  const semResults = semanticSearch(topic, maxNodes);

  // Merge and dedupe, preferring FTS ranking
  const nodeIds = new Set<string>();
  const orderedIds: string[] = [];

  for (const r of ftsResults) {
    if (!nodeIds.has(r.nodeId)) {
      nodeIds.add(r.nodeId);
      orderedIds.push(r.nodeId);
    }
  }
  for (const r of semResults) {
    if (!nodeIds.has(r.nodeId)) {
      nodeIds.add(r.nodeId);
      orderedIds.push(r.nodeId);
    }
  }

  if (orderedIds.length === 0) {
    return {
      layerId: 2,
      name: 'subgraph',
      tokenBudget: 500,
      content: `# Subgraph: "${topic}"\nNo matching nodes found.`,
    };
  }

  // Load full nodes
  const db = getDb();
  const nodes: MemoryNode[] = [];
  for (const id of orderedIds.slice(0, maxNodes)) {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (row) nodes.push(rowToNode(row));
  }

  // Get cross-edges between these nodes
  const idSet = new Set(nodes.map(n => n.id));
  const allEdges = db.prepare('SELECT * FROM cross_edges').all() as Array<Record<string, unknown>>;
  const relevantEdges = allEdges.filter(e =>
    idSet.has(e.source_id as string) && idSet.has(e.target_id as string)
  );

  const prioritized = prioritizeNodes(nodes, 400, 'relevance-first');

  const lines = [`# Subgraph: "${topic}"\n`];
  for (const node of prioritized) {
    lines.push(summarizeNode(node, 'standard'));
  }

  if (relevantEdges.length > 0) {
    lines.push('\nConnections:');
    for (const e of relevantEdges.slice(0, 10)) {
      const src = nodes.find(n => n.id === e.source_id as string);
      const tgt = nodes.find(n => n.id === e.target_id as string);
      if (src && tgt) {
        lines.push(`  ${src.label} —[${e.edge_type}]→ ${tgt.label}`);
      }
    }
  }

  const content = lines.join('\n');
  return {
    layerId: 2,
    name: 'subgraph',
    tokenBudget: 500,
    content,
  };
}

/**
 * Layer 3: Deep search (unlimited)
 * Full search results with stories, context, and knowledge graph facts.
 */
export function getDeepSearchLayer(query: string, options: { maxResults?: number; includeKgFacts?: boolean } = {}): ContextLayer {
  const { maxResults = 20, includeKgFacts = true } = options;

  const ftsResults = searchNodes(query, { limit: maxResults });
  const semResults = semanticSearch(query, maxResults);

  // Merge
  const seen = new Set<string>();
  const mergedIds: string[] = [];
  for (const r of [...ftsResults, ...semResults]) {
    const id = 'nodeId' in r ? r.nodeId : (r as { nodeId: string }).nodeId;
    if (!seen.has(id)) {
      seen.add(id);
      mergedIds.push(id);
    }
  }

  const db = getDb();
  const lines = [`# Deep Search: "${query}"\n`];

  for (const id of mergedIds.slice(0, maxResults)) {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) continue;
    const node = rowToNode(row);
    lines.push(summarizeNode(node, 'full'));

    // Include knowledge graph facts
    if (includeKgFacts) {
      const facts = queryFacts(id, { direction: 'both' });
      if (facts.length > 0) {
        for (const fact of facts.slice(0, 5)) {
          const current = !fact.validTo ? '' : ' [expired]';
          lines.push(`  Fact: ${fact.subject} ${fact.predicate} ${fact.object}${current}`);
        }
      }
    }

    lines.push('');
  }

  const content = lines.join('\n');
  return {
    layerId: 3,
    name: 'deep-search',
    tokenBudget: 0, // unlimited
    content,
  };
}

/**
 * Assemble context from multiple layers for a given query.
 */
export function assembleContext(query?: string, options: {
  maxTokens?: number;
  layers?: number[];
  hubFocus?: string;
} = {}): AssembledContext {
  const { maxTokens = 2000, layers: requestedLayers = [0, 1, 2], hubFocus } = options;

  const assembled: ContextLayer[] = [];
  let totalTokens = 0;
  let truncated = false;

  // Layer 0: always include
  if (requestedLayers.includes(0)) {
    const l0 = getIdentityLayer();
    const tokens = estimateTokens(l0.content);
    assembled.push(l0);
    totalTokens += tokens;
  }

  // Layer 1: hub summary
  if (requestedLayers.includes(1)) {
    const l1 = getHubSummaryLayer();
    const tokens = estimateTokens(l1.content);
    if (totalTokens + tokens <= maxTokens) {
      assembled.push(l1);
      totalTokens += tokens;
    } else {
      truncated = true;
    }
  }

  // Layer 2: on-demand subgraph (needs a query)
  if (requestedLayers.includes(2) && query) {
    const l2 = getSubgraphLayer(query, { hubFilter: hubFocus });
    const tokens = estimateTokens(l2.content);
    if (totalTokens + tokens <= maxTokens) {
      assembled.push(l2);
      totalTokens += tokens;
    } else {
      truncated = true;
    }
  }

  // Layer 3: deep search (needs a query)
  if (requestedLayers.includes(3) && query) {
    const l3 = getDeepSearchLayer(query);
    const tokens = estimateTokens(l3.content);
    assembled.push(l3);
    totalTokens += tokens;
    // Layer 3 doesn't respect budget — it's "unlimited"
  }

  return { layers: assembled, totalTokens, truncated };
}
