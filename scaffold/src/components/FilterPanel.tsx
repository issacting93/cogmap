import { useMemo } from 'react';
import type { MemoryNode, MemoryLevel, MemoryTier } from '../types';
import { SANS, MONO, BORDER, ACCENT } from '../constants';

const ALL_LEVELS: MemoryLevel[] = ['parts', 'aspects', 'points', 'stories'];
const LEVEL_LABELS: Record<MemoryLevel, string> = {
  world: 'World', parts: 'Hubs', aspects: 'Junctions', points: 'Stops', stories: 'Markers',
};
const TIER_LABELS: Record<MemoryTier, string> = { lt: 'Anchored', st: 'Draft' };

export interface Filters {
  levels: Set<MemoryLevel>;
  tiers: Set<MemoryTier>;
  hubs: Set<string>;
}

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  allNodes: MemoryNode[];
  filteredCount: number;
  hubColors: Map<string, string>;
  hubLabels: Map<string, string>;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function applyFilters(nodes: MemoryNode[], filters: Filters, findHub: (id: string) => string | null): MemoryNode[] {
  return nodes.filter(n => {
    if (n.level === 'world') return false;
    if (!filters.levels.has(n.level)) return false;
    if (!filters.tiers.has(n.tier)) return false;
    const hub = findHub(n.id);
    if (hub && !filters.hubs.has(hub)) return false;
    if (!hub && n.level !== 'parts') return false; // orphan non-hub
    if (n.level === 'parts' && !filters.hubs.has(n.id)) return false;
    return true;
  });
}

export function defaultFilters(nodes: MemoryNode[]): Filters {
  const hubs = new Set<string>();
  nodes.forEach(n => { if (n.level === 'parts') hubs.add(n.id); });
  return {
    levels: new Set<MemoryLevel>(ALL_LEVELS),
    tiers: new Set<MemoryTier>(['lt', 'st']),
    hubs,
  };
}

export default function FilterPanel({
  filters, onChange, allNodes, filteredCount, hubColors, hubLabels, collapsed, onToggleCollapse,
}: Props) {
  const hubs = useMemo(() => {
    return allNodes
      .filter(n => n.level === 'parts')
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [allNodes]);

  const totalNonWorld = useMemo(() => allNodes.filter(n => n.level !== 'world').length, [allNodes]);

  const toggleLevel = (level: MemoryLevel) => {
    const next = new Set(filters.levels);
    if (next.has(level)) next.delete(level); else next.add(level);
    onChange({ ...filters, levels: next });
  };

  const toggleTier = (tier: MemoryTier) => {
    const next = new Set(filters.tiers);
    if (next.has(tier)) next.delete(tier); else next.add(tier);
    onChange({ ...filters, tiers: next });
  };

  const toggleHub = (hubId: string) => {
    const next = new Set(filters.hubs);
    if (next.has(hubId)) next.delete(hubId); else next.add(hubId);
    onChange({ ...filters, hubs: next });
  };

  const allLevelsOn = filters.levels.size === ALL_LEVELS.length;
  const allHubsOn = filters.hubs.size === hubs.length;

  const toggleAllLevels = () => {
    onChange({
      ...filters,
      levels: allLevelsOn ? new Set<MemoryLevel>() : new Set<MemoryLevel>(ALL_LEVELS),
    });
  };

  const toggleAllHubs = () => {
    onChange({
      ...filters,
      hubs: allHubsOn ? new Set<string>() : new Set(hubs.map(h => h.id)),
    });
  };

  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        style={{
          position: 'absolute', top: 76, left: 16, zIndex: 10, cursor: 'pointer',
          background: 'rgba(255,255,253,0.97)', border: `1px solid ${BORDER}`,
          borderRadius: 8, padding: '8px 12px', backdropFilter: 'blur(8px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: SANS, fontSize: 12, color: '#666',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = ACCENT)}
        onMouseLeave={e => (e.currentTarget.style.borderColor = BORDER)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="18" x2="12" y2="18" />
        </svg>
        Filters
        <span style={{
          background: ACCENT, color: '#fff', borderRadius: 10,
          padding: '1px 7px', fontSize: 10, fontWeight: 600,
        }}>
          {filteredCount}
        </span>
      </div>
    );
  }

  const panelCss: React.CSSProperties = {
    position: 'absolute', top: 76, left: 16, zIndex: 10, width: 220,
    background: 'rgba(255,255,253,0.97)', border: `1px solid ${BORDER}`,
    borderRadius: 8, padding: '14px 16px', backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)', maxHeight: 'calc(100vh - 144px)',
    overflowY: 'auto',
  };

  const sectionTitle: React.CSSProperties = {
    fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
    color: '#aaa', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };

  const chipBase: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
    fontFamily: SANS, fontSize: 11, fontWeight: 500,
    transition: 'all 0.12s', userSelect: 'none',
    border: '1px solid transparent',
  };

  return (
    <div style={panelCss}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '#333' }}>
          Filters
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: ACCENT, color: '#fff', borderRadius: 10,
            padding: '1px 7px', fontSize: 10, fontWeight: 600,
          }}>
            {filteredCount} / {totalNonWorld}
          </span>
          <button
            onClick={onToggleCollapse}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#999',
              fontSize: 16, padding: '0 2px', lineHeight: 1,
            }}
            title="Collapse"
          >
            &laquo;
          </button>
        </div>
      </div>

      {/* Levels */}
      <div style={sectionTitle}>
        <span>Levels</span>
        <button
          onClick={toggleAllLevels}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: MONO, fontSize: 8, color: ACCENT, letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {allLevelsOn ? 'NONE' : 'ALL'}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
        {ALL_LEVELS.map(level => {
          const on = filters.levels.has(level);
          return (
            <div
              key={level}
              onClick={() => toggleLevel(level)}
              style={{
                ...chipBase,
                background: on ? `${ACCENT}12` : '#f5f5f3',
                color: on ? ACCENT : '#999',
                borderColor: on ? `${ACCENT}40` : 'transparent',
              }}
            >
              {LEVEL_LABELS[level]}
            </div>
          );
        })}
      </div>

      {/* Tier */}
      <div style={sectionTitle}>
        <span>Status</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {(['lt', 'st'] as MemoryTier[]).map(tier => {
          const on = filters.tiers.has(tier);
          return (
            <div
              key={tier}
              onClick={() => toggleTier(tier)}
              style={{
                ...chipBase, flex: 1, textAlign: 'center',
                background: on ? (tier === 'lt' ? '#e8f5e9' : '#fff3e0') : '#f5f5f3',
                color: on ? (tier === 'lt' ? '#2e7d32' : '#e65100') : '#999',
                borderColor: on ? (tier === 'lt' ? '#a5d6a7' : '#ffcc80') : 'transparent',
              }}
            >
              {tier === 'st' ? '\u25CC ' : '\u2713 '}{TIER_LABELS[tier]}
            </div>
          );
        })}
      </div>

      {/* Hubs (Lines) */}
      <div style={sectionTitle}>
        <span>Lines</span>
        <button
          onClick={toggleAllHubs}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: MONO, fontSize: 8, color: ACCENT, letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          {allHubsOn ? 'NONE' : 'ALL'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {hubs.map(hub => {
          const on = filters.hubs.has(hub.id);
          const color = hubColors.get(hub.id) ?? '#999';
          const label = hubLabels.get(hub.id) ?? hub.label;
          return (
            <div
              key={hub.id}
              onClick={() => toggleHub(hub.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
                borderRadius: 4, cursor: 'pointer',
                background: on ? 'transparent' : '#f5f5f3',
                opacity: on ? 1 : 0.5,
                transition: 'all 0.12s',
              }}
            >
              <div style={{
                width: 18, height: 4, borderRadius: 2, flexShrink: 0,
                background: color,
                opacity: on ? 1 : 0.3,
                transition: 'opacity 0.12s',
              }} />
              <div style={{
                fontFamily: SANS, fontSize: 11, fontWeight: 500,
                color: on ? '#333' : '#999',
                transition: 'color 0.12s',
              }}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
