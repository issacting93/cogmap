#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolve } from 'path';

import { getDb, closeDb } from './db.js';
import { loadSeed, watchSeed, getCurrentData } from './loader.js';
import { searchNodes } from './search/text-search.js';
import { semanticSearch, findSimilar, buildVectors } from './search/semantic.js';
import { traverse } from './graph/traversal.js';
import { getHubSubgraph, getNeighborhood, findPaths } from './graph/subgraph.js';
import { addFact, queryFacts, invalidateFact } from './knowledge/facts.js';
import { getTimeline, getNodeHistory, getRecentChanges } from './knowledge/timeline.js';
import { assembleContext } from './context/layers.js';

// ── Resolve seed path ──

const seedPath = process.env.COGMAP_SEED_PATH
  ?? resolve(process.cwd(), 'map-viewer', 'src', 'seed.ts');

const dbPath = process.env.COGMAP_DB_PATH
  ?? resolve(process.cwd(), 'map-engine', 'data', 'cogmap.db');

// ── MCP Server ──

const server = new McpServer({
  name: 'cogmap',
  version: '0.5.0',
});

// ── Tool: cogmap_status ──

server.tool(
  'cogmap_status',
  'Get cognitive map overview: node counts, hub names, tier distribution, active facts',
  {},
  async () => {
    const db = getDb(dbPath);
    const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM nodes').get() as { c: number }).c;
    const edgeCount = (db.prepare('SELECT COUNT(*) AS c FROM cross_edges').get() as { c: number }).c;
    const factCount = (db.prepare('SELECT COUNT(*) AS c FROM facts WHERE valid_to IS NULL').get() as { c: number }).c;

    const hubs = db.prepare("SELECT id, label, tier FROM nodes WHERE level = 'parts' ORDER BY label")
      .all() as Array<{ id: string; label: string; tier: string }>;

    const tiers = db.prepare("SELECT tier, COUNT(*) AS c FROM nodes WHERE level != 'world' GROUP BY tier")
      .all() as Array<{ tier: string; c: number }>;

    const recent = getRecentChanges(5);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          nodes: nodeCount,
          crossEdges: edgeCount,
          activeFacts: factCount,
          hubs: hubs.map(h => ({ id: h.id, label: h.label, tier: h.tier })),
          tiers: Object.fromEntries(tiers.map(t => [t.tier, t.c])),
          recentChanges: recent.slice(0, 5),
        }, null, 2),
      }],
    };
  },
);

// ── Tool: cogmap_search ──

server.tool(
  'cogmap_search',
  'Search the cognitive map using full-text search (FTS5) and TF-IDF semantic similarity. Returns ranked results across node labels, stories, and context.',
  {
    query: z.string().describe('Search query text'),
    level: z.enum(['world', 'parts', 'aspects', 'points', 'stories']).optional().describe('Filter by hierarchy level'),
    tier: z.enum(['lt', 'st']).optional().describe('Filter by tier: lt=anchored, st=draft'),
    hub: z.string().optional().describe('Filter to nodes under a specific hub ID'),
    limit: z.number().optional().default(10).describe('Max results'),
    mode: z.enum(['text', 'semantic', 'hybrid']).optional().default('hybrid').describe('Search mode'),
  },
  async ({ query, level, tier, hub, limit, mode }) => {
    const results: Array<{ nodeId: string; label: string; score: number; source: string; snippet?: string }> = [];

    if (mode === 'text' || mode === 'hybrid') {
      const fts = searchNodes(query, { level, tier, hubId: hub, limit });
      for (const r of fts) {
        results.push({ nodeId: r.nodeId, label: r.label, score: -r.rank, source: 'fts', snippet: r.snippet });
      }
    }

    if (mode === 'semantic' || mode === 'hybrid') {
      const sem = semanticSearch(query, limit);
      for (const r of sem) {
        if (!results.some(x => x.nodeId === r.nodeId)) {
          results.push({ nodeId: r.nodeId, label: r.label, score: r.similarity, source: 'semantic' });
        }
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ query, resultCount: results.length, results }, null, 2),
      }],
    };
  },
);

// ── Tool: cogmap_traverse ──

server.tool(
  'cogmap_traverse',
  'Walk the cognitive map graph from a starting node. Follows hierarchy edges (parent/child) and cross-edges. Returns all visited nodes and the edges traversed.',
  {
    start_id: z.string().describe('Node ID to start traversal from'),
    max_depth: z.number().optional().default(2).describe('Maximum traversal depth'),
    direction: z.enum(['up', 'down', 'both']).optional().default('both').describe('Hierarchy direction'),
    include_cross_edges: z.boolean().optional().default(true).describe('Follow cross-edges too'),
    strategy: z.enum(['bfs', 'dfs']).optional().default('bfs').describe('Traversal strategy'),
    edge_type_filter: z.array(z.string()).optional().describe('Only follow these cross-edge types'),
  },
  async ({ start_id, max_depth, direction, include_cross_edges, strategy, edge_type_filter }) => {
    const result = traverse(start_id, {
      maxDepth: max_depth,
      direction,
      includeCrossEdges: include_cross_edges,
      strategy,
      edgeTypeFilter: edge_type_filter,
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          startId: start_id,
          nodesVisited: result.visited.length,
          edgesTraversed: result.edges.length,
          maxDepthReached: result.depth,
          nodes: result.visited.map(n => ({ id: n.id, label: n.label, level: n.level, tier: n.tier })),
          edges: result.edges,
        }, null, 2),
      }],
    };
  },
);

// ── Tool: cogmap_subgraph ──

server.tool(
  'cogmap_subgraph',
  'Extract a subgraph from the cognitive map. Get all nodes under a hub, the neighborhood around a node, or find paths between two nodes.',
  {
    mode: z.enum(['hub', 'neighborhood', 'paths']).describe('Extraction mode'),
    hub_id: z.string().optional().describe('Hub ID (for hub mode)'),
    node_id: z.string().optional().describe('Center node ID (for neighborhood mode) or start node (for paths mode)'),
    target_id: z.string().optional().describe('Target node ID (for paths mode)'),
    radius: z.number().optional().default(1).describe('Neighborhood radius (hops)'),
    max_depth: z.number().optional().default(5).describe('Max path length (for paths mode)'),
  },
  async ({ mode, hub_id, node_id, target_id, radius, max_depth }) => {
    if (mode === 'hub') {
      if (!hub_id) return { content: [{ type: 'text' as const, text: 'Error: hub_id required for hub mode' }] };
      const sub = getHubSubgraph(hub_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            mode: 'hub',
            hubId: hub_id,
            nodeCount: sub.nodes.length,
            edgeCount: sub.edges.length,
            nodes: sub.nodes.map(n => ({ id: n.id, label: n.label, level: n.level, tier: n.tier, story: n.story })),
            edges: sub.edges.map(e => ({ source: e.sourceAnchorId, target: e.targetAnchorId, type: e.edgeType })),
          }, null, 2),
        }],
      };
    }

    if (mode === 'neighborhood') {
      if (!node_id) return { content: [{ type: 'text' as const, text: 'Error: node_id required for neighborhood mode' }] };
      const sub = getNeighborhood(node_id, radius);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            mode: 'neighborhood',
            centerId: node_id,
            radius,
            nodeCount: sub.nodes.length,
            edgeCount: sub.edges.length,
            nodes: sub.nodes.map(n => ({ id: n.id, label: n.label, level: n.level, tier: n.tier, story: n.story })),
            edges: sub.edges.map(e => ({ source: e.sourceAnchorId, target: e.targetAnchorId, type: e.edgeType })),
          }, null, 2),
        }],
      };
    }

    if (mode === 'paths') {
      if (!node_id || !target_id) return { content: [{ type: 'text' as const, text: 'Error: node_id and target_id required for paths mode' }] };
      const paths = findPaths(node_id, target_id, max_depth);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            mode: 'paths',
            from: node_id,
            to: target_id,
            pathCount: paths.length,
            paths: paths.slice(0, 10),
          }, null, 2),
        }],
      };
    }

    return { content: [{ type: 'text' as const, text: 'Error: invalid mode' }] };
  },
);

// ── Tool: cogmap_context ──

server.tool(
  'cogmap_context',
  'Assemble context-engineered map data for Claude. Uses a 4-layer stack: L0=identity (~100 tokens), L1=hub summary (~800 tokens), L2=on-demand subgraph, L3=deep search. Only loads what you need.',
  {
    query: z.string().optional().describe('Topic or question to focus context on (required for L2/L3)'),
    max_tokens: z.number().optional().default(2000).describe('Total token budget'),
    layers: z.array(z.number()).optional().default([0, 1, 2]).describe('Which layers to include (0-3)'),
    hub_focus: z.string().optional().describe('Bias context toward a specific hub ID'),
  },
  async ({ query, max_tokens, layers, hub_focus }) => {
    const ctx = assembleContext(query, { maxTokens: max_tokens, layers, hubFocus: hub_focus });

    // Return assembled context as a single block
    const combined = ctx.layers.map(l => l.content).join('\n\n---\n\n');

    return {
      content: [{
        type: 'text' as const,
        text: combined,
      }],
    };
  },
);

// ── Tool: cogmap_facts ──

server.tool(
  'cogmap_facts',
  'Query the knowledge graph for temporal facts about cognitive map entities. Facts have validity windows (valid_from/valid_to) for tracking changes over time.',
  {
    entity: z.string().describe('Node ID or entity name to query facts for'),
    direction: z.enum(['outgoing', 'incoming', 'both']).optional().default('both'),
    as_of: z.string().optional().describe('ISO date — only return facts valid at this point in time'),
    predicate: z.string().optional().describe('Filter by relationship type'),
  },
  async ({ entity, direction, as_of, predicate }) => {
    const facts = queryFacts(entity, { direction, asOf: as_of, predicate });
    const timeline = getTimeline(entity);
    const history = getNodeHistory(entity);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          entity,
          factCount: facts.length,
          facts,
          timeline: timeline.slice(0, 20),
          nodeHistory: history.slice(0, 20),
        }, null, 2),
      }],
    };
  },
);

// ── Tool: cogmap_add_fact ──

server.tool(
  'cogmap_add_fact',
  'Add a temporal fact to the knowledge graph. Facts track relationships between entities with optional validity windows.',
  {
    subject: z.string().describe('Subject node ID or entity'),
    predicate: z.string().describe('Relationship type (e.g., DEPENDS_ON, IMPLEMENTS, REPLACED_BY)'),
    object: z.string().describe('Object node ID or value'),
    valid_from: z.string().optional().describe('ISO date when this fact became true'),
    source: z.string().optional().describe('Where this fact came from'),
  },
  async ({ subject, predicate, object, valid_from, source }) => {
    const fact = addFact(subject, predicate, object, { validFrom: valid_from, source });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ created: fact }, null, 2),
      }],
    };
  },
);

// ── Tool: cogmap_invalidate_fact ──

server.tool(
  'cogmap_invalidate_fact',
  'Mark a fact as no longer valid (sets valid_to date). The fact remains in the knowledge graph for historical queries.',
  {
    fact_id: z.number().describe('Fact ID to invalidate'),
    valid_to: z.string().optional().describe('ISO date when this fact stopped being true (defaults to now)'),
  },
  async ({ fact_id, valid_to }) => {
    invalidateFact(fact_id, valid_to);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ invalidated: fact_id, validTo: valid_to ?? new Date().toISOString() }),
      }],
    };
  },
);

// ── Boot ──

async function main() {
  // Initialize database
  getDb(dbPath);

  // Load seed data
  try {
    const result = await loadSeed(seedPath);
    buildVectors(result.nodes);
    console.error(`[cogmap] Loaded ${result.nodes.length} nodes, ${result.crossEdges.length} edges`);
  } catch (err) {
    console.error(`[cogmap] Warning: Could not load seed (${err}). Engine running with empty data.`);
  }

  // Watch for seed changes
  watchSeed(seedPath, (result) => {
    buildVectors(result.nodes);
    console.error(`[cogmap] Reloaded: ${result.nodes.length} nodes, ${result.crossEdges.length} edges`);
  });

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[cogmap] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[cogmap] Fatal error:', err);
  closeDb();
  process.exit(1);
});

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
