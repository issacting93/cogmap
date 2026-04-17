// Re-export viewer types
export type MemoryLevel = 'world' | 'parts' | 'aspects' | 'points' | 'stories';
export type MemoryTier = 'lt' | 'st';

export interface MemoryNode {
  id: string;
  label: string;
  level: MemoryLevel;
  tier: MemoryTier;
  parentId: string | null;
  story?: string;
  context?: string;
  x: number;
  y: number;
}

export interface CrossEdge {
  id: string;
  sourceAnchorId: string;
  targetAnchorId: string;
  edgeType: string;
  confidence: number;
}

// Engine-specific types

export interface SearchResult {
  nodeId: string;
  label: string;
  level: MemoryLevel;
  tier: MemoryTier;
  snippet: string;
  rank: number;
  matchField: string;
}

export interface SemanticResult {
  nodeId: string;
  label: string;
  similarity: number;
}

export interface TraversalResult {
  visited: MemoryNode[];
  edges: TraversalEdge[];
  depth: number;
}

export interface TraversalEdge {
  from: string;
  to: string;
  type: 'hierarchy' | 'cross-edge';
  edgeType?: string;
}

export interface Fact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  validTo: string | null;
  source: string | null;
  createdAt: string;
}

export interface ChangelogEntry {
  id: number;
  nodeId: string;
  changeType: 'added' | 'removed' | 'modified';
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  detectedAt: string;
}

export interface ContextLayer {
  layerId: 0 | 1 | 2 | 3;
  name: string;
  tokenBudget: number;
  content: string;
}

export interface AssembledContext {
  layers: ContextLayer[];
  totalTokens: number;
  truncated: boolean;
}
