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
  isGhost?: boolean;
  sourceMessageId?: string;
  conversationId?: string;
}

export interface CrossEdge {
  id: string;
  sourceAnchorId: string;
  targetAnchorId: string;
  edgeType: string;
  confidence: number;
}
