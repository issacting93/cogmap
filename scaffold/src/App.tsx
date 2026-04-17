import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from './store';
import type { MemoryNode } from './types';
import MapTerrainView from './map/MapTerrainView';
import SearchBar from './components/SearchBar';
import FilterPanel, { applyFilters, defaultFilters } from './components/FilterPanel';
import type { Filters } from './components/FilterPanel';
import PathFinder from './components/PathFinder';
import { findPath } from './map/pathfinding';
import type { PathResult } from './map/pathfinding';
import { WORLD_NODE_ID, LINE_COLORS, SANS, MONO, BORDER } from './constants';

export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const anchors = useAppStore((s) => s.anchors);
  const crossEdges = useAppStore((s) => s.crossEdges);

  // Non-world nodes for filtering / search
  const allNodes = useMemo(() => anchors.filter(n => n.level !== 'world'), [anchors]);

  // Hub lookup: node → root part id
  const byId = useMemo(() => {
    const m = new Map<string, MemoryNode>();
    anchors.forEach(n => m.set(n.id, n));
    return m;
  }, [anchors]);

  const findHub = useCallback((nodeId: string): string | null => {
    let cur = byId.get(nodeId);
    while (cur) {
      if (cur.level === 'parts') return cur.id;
      if (!cur.parentId || cur.parentId === WORLD_NODE_ID) return null;
      cur = byId.get(cur.parentId);
    }
    return null;
  }, [byId]);

  // Hub colors + labels
  const hubColors = useMemo(() => {
    const m = new Map<string, string>();
    const parts = allNodes.filter(n => n.level === 'parts').sort((a, b) => a.id.localeCompare(b.id));
    parts.forEach((p, i) => m.set(p.id, LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [allNodes]);

  const hubLabels = useMemo(() => {
    const m = new Map<string, string>();
    allNodes.filter(n => n.level === 'parts').forEach(p => m.set(p.id, p.label));
    return m;
  }, [allNodes]);

  // ── Filters ──
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(anchors));
  const [filterCollapsed, setFilterCollapsed] = useState(false);

  const filteredNodes = useMemo(
    () => applyFilters(allNodes, filters, findHub),
    [allNodes, filters, findHub],
  );

  // ── Search / Focus ──
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const handleSearchSelect = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setFocusNodeId(nodeId);
  }, []);

  const handleFocusComplete = useCallback(() => {
    setFocusNodeId(null);
  }, []);

  // ── Path mode ──
  const [pathMode, setPathMode] = useState(false);
  const [pathResult, setPathResult] = useState<PathResult | null>(null);

  const handleFindPath = useCallback((fromId: string, toId: string) => {
    const result = findPath(allNodes, crossEdges, fromId, toId);
    setPathResult(result);
    // Focus on the midpoint of the path
    if (result.found && result.path.length > 0) {
      const mid = result.path[Math.floor(result.path.length / 2)];
      setFocusNodeId(mid);
    }
  }, [allNodes, crossEdges]);

  const handleClearPath = useCallback(() => {
    setPathResult(null);
  }, []);

  const handleClosePath = useCallback(() => {
    setPathMode(false);
    setPathResult(null);
  }, []);

  const handlePathSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setFocusNodeId(nodeId);
  }, []);

  if (allNodes.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#fafaf7',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontFamily: MONO, fontSize: 32, marginBottom: 20, opacity: 0.15 }}>◉</div>
          <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 500, color: '#444', marginBottom: 6 }}>
            Your map is empty
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: '#aaa', marginBottom: 24, lineHeight: 1.7 }}>
            Run <code style={{
              background: '#f0f0ee', border: `1px solid ${BORDER}`,
              borderRadius: 4, padding: '1px 6px', fontFamily: MONO, fontSize: 11, color: '#555',
            }}>/update-map</code> in Claude Code to scan your project and populate the map.
          </div>
          <div style={{
            border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden',
            background: '#fff', textAlign: 'left',
          }}>
            {[
              ['◉', 'Hubs', 'Top-level pillars of your project'],
              ['○', 'Junctions', 'Major sub-components and themes'],
              ['•', 'Stops', 'Specific concepts, files, or features'],
              ['·', 'Markers', 'Fine-grained leaf detail'],
            ].map(([icon, label, desc], i, arr) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 16px',
                borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none',
              }}>
                <span style={{ fontFamily: MONO, fontSize: 14, color: '#bbb', width: 14, textAlign: 'center' }}>{icon}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 500, color: '#555', width: 72 }}>{label}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: '#aaa' }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapTerrainView
        nodes={filteredNodes}
        selectedNodeId={selectedNodeId}
        onNodeClick={(id) => setSelectedNodeId(id)}
        onBackgroundClick={() => setSelectedNodeId(null)}
        highlightedPath={pathResult?.found ? pathResult.path : undefined}
        focusNodeId={focusNodeId}
        onFocusComplete={handleFocusComplete}
      />

      {/* Top left: Search or PathFinder */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        zIndex: 15,
      }}>
        {pathMode ? (
          <PathFinder
            nodes={allNodes}
            hubColors={hubColors}
            findHub={findHub}
            result={pathResult}
            onFindPath={handleFindPath}
            onClear={handleClearPath}
            onClose={handleClosePath}
            onSelectNode={handlePathSelectNode}
          />
        ) : (
          <SearchBar
            nodes={allNodes}
            hubColors={hubColors}
            findHub={findHub}
            onSelect={handleSearchSelect}
            onStartPath={() => setPathMode(true)}
          />
        )}
      </div>

      {/* Left: Filter panel */}
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        allNodes={allNodes}
        filteredCount={filteredNodes.length}
        hubColors={hubColors}
        hubLabels={hubLabels}
        collapsed={filterCollapsed}
        onToggleCollapse={() => setFilterCollapsed(c => !c)}
      />
    </div>
  );
}
