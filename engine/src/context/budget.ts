import type { MemoryNode } from '../types.js';

/**
 * Approximate token count (English text averages ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type Verbosity = 'minimal' | 'standard' | 'full';

/**
 * Summarize a node for context output at different verbosity levels.
 */
export function summarizeNode(node: MemoryNode, verbosity: Verbosity = 'standard'): string {
  const tierLabel = node.tier === 'lt' ? 'anchored' : 'draft';

  switch (verbosity) {
    case 'minimal':
      return `- ${node.label} [${node.level}/${tierLabel}]`;

    case 'standard':
      const story = node.story ? `: ${node.story}` : '';
      return `- ${node.label} [${node.level}/${tierLabel}]${story}`;

    case 'full':
      const lines = [`- **${node.label}** (${node.id})`];
      lines.push(`  Level: ${node.level} | Tier: ${tierLabel}`);
      if (node.story) lines.push(`  ${node.story}`);
      if (node.context) lines.push(`  Context: ${node.context}`);
      return lines.join('\n');
  }
}

export type PrioritizeStrategy = 'breadth-first' | 'relevance-first';

/**
 * Select nodes that fit within a token budget.
 * breadth-first: prefer higher-level nodes (hubs before junctions before stops)
 * relevance-first: nodes are already sorted by relevance, just take what fits
 */
export function prioritizeNodes(
  nodes: MemoryNode[],
  budget: number,
  strategy: PrioritizeStrategy = 'breadth-first',
  verbosity: Verbosity = 'standard',
): MemoryNode[] {
  let sorted: MemoryNode[];

  if (strategy === 'breadth-first') {
    const levelOrder: Record<string, number> = {
      world: 0, parts: 1, aspects: 2, points: 3, stories: 4,
    };
    sorted = [...nodes].sort((a, b) => {
      const levelDiff = (levelOrder[a.level] ?? 5) - (levelOrder[b.level] ?? 5);
      if (levelDiff !== 0) return levelDiff;
      // Prefer anchored over draft at same level
      return a.tier === 'lt' ? -1 : 1;
    });
  } else {
    sorted = nodes; // Already ordered by relevance
  }

  const selected: MemoryNode[] = [];
  let usedTokens = 0;

  for (const node of sorted) {
    const summary = summarizeNode(node, verbosity);
    const tokens = estimateTokens(summary);
    if (usedTokens + tokens > budget) break;
    selected.push(node);
    usedTokens += tokens;
  }

  return selected;
}
