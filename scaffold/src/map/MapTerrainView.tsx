import { useEffect, useRef, useMemo, useCallback, useReducer, useState } from 'react';
import type { MemoryNode, MemoryLevel } from '../types';
import { useAppStore } from '../store';
import { forceLayout, suggestConnections } from './mapForceLayout';
import {
  WORLD_NODE_ID, LINE_COLORS, SANS, MONO,
  ACCENT, TEXT, DIM, BORDER, BG, ORPHAN_COLOR,
} from '../constants';

/* ── Props ──────────────────────────────────────────────────────────────────── */

interface Props {
  nodes: MemoryNode[];
  selectedNodeId: string | null;
  onNodeClick: (id: string) => void;
  onBackgroundClick?: () => void;
  /** Node IDs forming a highlighted path (in order) */
  highlightedPath?: string[];
  /** Node to auto-pan/zoom to */
  focusNodeId?: string | null;
  /** Called after focus animation completes */
  onFocusComplete?: () => void;
}

/* ── Map vocabulary ─────────────────────────────────────────────────────────── */

const ROLE: Record<string, string> = {
  parts: 'Hub', aspects: 'Junction', points: 'Stop', stories: 'Marker',
};
const STATE: Record<string, string> = { lt: 'Anchored', st: 'Draft' };
const NEXT_LEVEL: Record<string, MemoryLevel> = {
  parts: 'aspects', aspects: 'points', points: 'stories', stories: 'stories',
};
const ADD_LABEL: Record<string, string> = {
  parts: 'Add junction', aspects: 'Add stop', points: 'Add marker', stories: 'Add marker',
};
const NEW_DEFAULT: Record<string, string> = {
  parts: 'New junction', aspects: 'New stop', points: 'New marker', stories: 'New marker',
};

/* ── Constants ──────────────────────────────────────────────────────────────── */

const SCALE = 55;

const PANEL_W = 280;
const PANEL_H_EST = 240;

// Warm amber for "you haven't looked at this yet" — distinct from accent (selection)
const NEW_PULSE = '#FFA500';

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function findRootPart(nodeId: string, byId: Map<string, MemoryNode>): string | null {
  let cur = byId.get(nodeId);
  while (cur) {
    if (cur.level === 'parts') return cur.id;
    if (!cur.parentId || cur.parentId === WORLD_NODE_ID) return null;
    cur = byId.get(cur.parentId);
  }
  return null;
}

function metroPath(ax: number, ay: number, bx: number, by: number): string {
  const dx = bx - ax;
  const dy = by - ay;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 2 || ady < 2) return `M ${ax} ${ay} L ${bx} ${by}`;
  if (adx > ady) {
    const midX = ax + Math.sign(dx) * ady;
    return `M ${ax} ${ay} L ${midX} ${by} L ${bx} ${by}`;
  }
  const midY = ay + Math.sign(dy) * adx;
  return `M ${ax} ${ay} L ${bx} ${midY} L ${bx} ${by}`;
}

function stationRadius(level: string, zoom: number): number {
  const base = level === 'parts' ? 14 : level === 'aspects' ? 9 : level === 'points' ? 6 : 4;
  return base * Math.min(1.4, Math.max(0.85, zoom));
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export default function MapTerrainView({ nodes, selectedNodeId, onNodeClick, onBackgroundClick, highlightedPath, focusNodeId, onFocusComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Store actions
  const crossEdges = useAppStore(s => s.crossEdges);
  const addAnchor = useAppStore(s => s.addAnchor);
  const updateAnchor = useAppStore(s => s.updateAnchor);
  const removeAnchor = useAppStore(s => s.removeAnchor);
  const promoteAnchor = useAppStore(s => s.promoteAnchor);
  const addCrossEdge = useAppStore(s => s.addCrossEdge);
  const updateCrossEdge = useAppStore(s => s.updateCrossEdge);
  const removeCrossEdge = useAppStore(s => s.removeCrossEdge);
  const demoteAnchor = useAppStore(s => s.demoteAnchor);
  const undo = useAppStore(s => s.undo);
  const redo = useAppStore(s => s.redo);
  const saveSeed = useAppStore(s => s.saveSeed);
  const isDirty = useAppStore(s => s.isDirty);
  const canUndo = useAppStore(s => s.canUndo);
  const canRedo = useAppStore(s => s.canRedo);

  // Pan/zoom (refs + RAF-batched forceUpdate)
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const sizeRef = useRef({ w: 1200, h: 800 });
  const [, forceUpdate] = useReducer(x => x + 1, 0);
  const inputRafRef = useRef<number | null>(null);
  const requestRedraw = useCallback(() => {
    if (inputRafRef.current !== null) return;
    inputRafRef.current = requestAnimationFrame(() => {
      inputRafRef.current = null;
      forceUpdate();
    });
  }, []);

  // Interaction state
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState(false);
  const [editingStory, setEditingStory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  // Unseen nodes get a persistent pulse until the user interacts with them.
  // Only populated for nodes added AFTER the initial load (not for seed data).
  const [unseenIds, setUnseenIds] = useState<Set<string>>(new Set());

  /* ── Path highlight set ───────────────────────────────────────────────────── */

  const pathSet = useMemo(() => new Set(highlightedPath ?? []), [highlightedPath]);
  const hasPath = pathSet.size > 1;

  /* ── Derived data ─────────────────────────────────────────────────────────── */

  const anchors = useMemo(() => nodes.filter(n => n.level !== 'world'), [nodes]);

  const byId = useMemo(() => {
    const m = new Map<string, MemoryNode>();
    anchors.forEach(n => m.set(n.id, n));
    return m;
  }, [anchors]);

  // Force-directed target positions (in world units)
  const worldPos = useMemo(
    () => forceLayout(anchors, crossEdges),
    [anchors, crossEdges],
  );

  const partColor = useMemo(() => {
    const m = new Map<string, string>();
    const parts = anchors.filter(n => n.level === 'parts').sort((a, b) => a.id.localeCompare(b.id));
    parts.forEach((p, i) => m.set(p.id, LINE_COLORS[i % LINE_COLORS.length]));
    return m;
  }, [anchors]);

  const nodeColorOf = useCallback((id: string): string => {
    const root = findRootPart(id, byId);
    if (root) return partColor.get(root) ?? ORPHAN_COLOR;
    return ORPHAN_COLOR;
  }, [byId, partColor]);

  // Cities — store color/label/radius; hub position computed at render time
  const cities = useMemo(() => {
    const result: Array<{ id: string; label: string; color: string; r: number }> = [];
    const parts = anchors.filter(n => n.level === 'parts');
    parts.forEach(part => {
      const hub = worldPos.get(part.id);
      if (!hub) return;
      let maxD = 0;
      anchors.forEach(a => {
        if (findRootPart(a.id, byId) !== part.id) return;
        const ap = worldPos.get(a.id);
        if (!ap) return;
        const d = Math.hypot(ap.x - hub.x, ap.y - hub.y);
        if (d > maxD) maxD = d;
      });
      result.push({
        id: part.id,
        label: part.label,
        color: partColor.get(part.id) ?? ORPHAN_COLOR,
        r: maxD + 0.6,
      });
    });
    return result;
  }, [anchors, worldPos, byId, partColor]);

  const selectedDetail = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = anchors.find(n => n.id === selectedNodeId);
    if (!node) return null;
    let cityLabel = 'Unmapped', cityColor = ORPHAN_COLOR;
    let cur: MemoryNode | undefined = node;
    while (cur) {
      if (cur.level === 'parts') {
        cityLabel = cur.label;
        cityColor = partColor.get(cur.id) ?? ORPHAN_COLOR;
        break;
      }
      cur = byId.get(cur.parentId ?? '');
    }
    return { node, cityLabel, cityColor };
  }, [selectedNodeId, anchors, byId, partColor]);

  useEffect(() => { setEditingLabel(false); setEditingStory(false); setSelectedEdgeId(null); }, [selectedNodeId]);

  /* ── Position interpolation (smooth reflow on layout changes) ─────────────── */

  const displayPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const targetPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const posAnimRef = useRef<number | null>(null);

  const stepPositions = useCallback(() => {
    const t = targetPosRef.current;
    const d = displayPosRef.current;
    let stillMoving = false;
    d.forEach((pt, id) => {
      const target = t.get(id);
      if (!target) return;
      const dx = target.x - pt.x;
      const dy = target.y - pt.y;
      if (Math.abs(dx) > 0.005 || Math.abs(dy) > 0.005) {
        pt.x += dx * 0.16;
        pt.y += dy * 0.16;
        stillMoving = true;
      } else {
        pt.x = target.x;
        pt.y = target.y;
      }
    });
    forceUpdate();
    if (stillMoving) {
      posAnimRef.current = requestAnimationFrame(stepPositions);
    } else {
      posAnimRef.current = null;
    }
  }, []);

  useEffect(() => {
    targetPosRef.current = worldPos;
    // Init new entries at target so they don't lerp from origin
    worldPos.forEach((p, id) => {
      if (!displayPosRef.current.has(id)) {
        displayPosRef.current.set(id, { x: p.x, y: p.y });
      }
    });
    // Drop entries no longer in target
    const toRemove: string[] = [];
    displayPosRef.current.forEach((_, id) => {
      if (!worldPos.has(id)) toRemove.push(id);
    });
    toRemove.forEach(id => displayPosRef.current.delete(id));

    if (posAnimRef.current === null) {
      posAnimRef.current = requestAnimationFrame(stepPositions);
    }
  }, [worldPos, stepPositions]);

  // Lazy fallback: if displayPos is empty (first paint), use target directly
  const getPos = useCallback((id: string): { x: number; y: number } | undefined => {
    let p = displayPosRef.current.get(id);
    if (!p) {
      const t = worldPos.get(id);
      if (t) {
        p = { x: t.x, y: t.y };
        displayPosRef.current.set(id, p);
      }
    }
    return p;
  }, [worldPos]);

  /* ── New-station tracking (drives scale-in animation) ─────────────────────── */

  const knownIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    const fresh = new Set<string>();
    anchors.forEach(a => {
      if (!knownIdsRef.current.has(a.id)) {
        fresh.add(a.id);
        knownIdsRef.current.add(a.id);
      }
    });
    if (fresh.size > 0) {
      // Scale-in pop — runs for both initial seed AND subsequent additions
      setNewIds(prev => new Set([...prev, ...fresh]));
      const timer = setTimeout(() => {
        setNewIds(prev => {
          const next = new Set(prev);
          fresh.forEach(id => next.delete(id));
          return next;
        });
      }, 600);
      // Persistent "unseen" pulse — only for additions after initial mount.
      // Otherwise all 16 seed anchors would pulse at you on first load.
      if (hasInitializedRef.current) {
        setUnseenIds(prev => new Set([...prev, ...fresh]));
      }
      hasInitializedRef.current = true;
      return () => clearTimeout(timer);
    }
    hasInitializedRef.current = true;
  }, [anchors]);

  // Selecting a node marks it as seen (clears the amber pulse)
  useEffect(() => {
    if (!selectedNodeId) return;
    setUnseenIds(prev => {
      if (!prev.has(selectedNodeId)) return prev;
      const next = new Set(prev);
      next.delete(selectedNodeId);
      return next;
    });
  }, [selectedNodeId]);

  /* ── Transform helpers ────────────────────────────────────────────────────── */

  const w2s = useCallback((wx: number, wy: number): [number, number] => {
    const { w, h } = sizeRef.current;
    const z = zoomRef.current, p = panRef.current;
    return [(wx - p.x) * z * SCALE + w / 2, (wy - p.y) * z * SCALE + h / 2];
  }, []);

  /* ── Focus node: auto-pan/zoom ─────────────────────────────────────────── */

  const focusAnimRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusNodeId) return;
    const target = worldPos.get(focusNodeId);
    if (!target) return;

    const targetZoom = 1.6;
    let frame = 0;
    const frames = 30;
    const startPan = { ...panRef.current };
    const startZoom = zoomRef.current;

    const step = () => {
      frame++;
      const t = frame / frames;
      // ease-out cubic
      const e = 1 - Math.pow(1 - t, 3);
      panRef.current = {
        x: startPan.x + (target.x - startPan.x) * e,
        y: startPan.y + (target.y - startPan.y) * e,
      };
      zoomRef.current = startZoom + (targetZoom - startZoom) * e;
      forceUpdate();
      if (frame < frames) {
        focusAnimRef.current = requestAnimationFrame(step);
      } else {
        focusAnimRef.current = null;
        onFocusComplete?.();
      }
    };
    focusAnimRef.current = requestAnimationFrame(step);
    return () => {
      if (focusAnimRef.current !== null) cancelAnimationFrame(focusAnimRef.current);
    };
  }, [focusNodeId, worldPos, onFocusComplete]);

  /* ── Manipulation ─────────────────────────────────────────────────────────── */

  const createNew = useCallback((opts: { parentId: string | null; level: MemoryLevel; label: string }) => {
    return addAnchor({
      label: opts.label,
      tier: 'st', level: opts.level, parentId: opts.parentId,
      x: 1100, y: 820,
    });
  }, [addAnchor]);

  const handleStationClick = useCallback((id: string) => {
    if (connectFromId) {
      if (connectFromId !== id) {
        addCrossEdge({
          sourceAnchorId: connectFromId, targetAnchorId: id,
          edgeType: 'CO_OCCURS_WITH', confidence: 0.8,
        });
      }
      setConnectFromId(null);
    } else {
      onNodeClick(id);
    }
  }, [connectFromId, addCrossEdge, onNodeClick]);

  const handleAddChild = useCallback(() => {
    if (!selectedDetail) return;
    const parent = selectedDetail.node;
    const childLevel = NEXT_LEVEL[parent.level] ?? 'points';
    const newId = createNew({
      parentId: parent.id, level: childLevel,
      label: NEW_DEFAULT[parent.level] ?? 'New stop',
    });
    onNodeClick(newId);
    setEditingLabel(true);
  }, [selectedDetail, createNew, onNodeClick]);

  const handleAnchor = useCallback(() => {
    if (!selectedDetail) return;
    promoteAnchor(selectedDetail.node.id);
  }, [selectedDetail, promoteAnchor]);

  const handleDemote = useCallback(() => {
    if (!selectedDetail) return;
    demoteAnchor(selectedDetail.node.id);
  }, [selectedDetail, demoteAnchor]);

  const handleRemove = useCallback(() => {
    if (!selectedDetail) return;
    if (window.confirm(`Remove "${selectedDetail.node.label}" from the map?`)) {
      removeAnchor(selectedDetail.node.id);
    }
  }, [selectedDetail, removeAnchor]);

  const handleLabelSave = useCallback((newLabel: string) => {
    if (!selectedDetail) return;
    const trimmed = newLabel.trim();
    if (trimmed && trimmed !== selectedDetail.node.label) {
      updateAnchor(selectedDetail.node.id, { label: trimmed });
    }
    setEditingLabel(false);
  }, [selectedDetail, updateAnchor]);

  const handleStorySave = useCallback((newStory: string) => {
    if (!selectedDetail) return;
    if (newStory !== (selectedDetail.node.story ?? '')) {
      updateAnchor(selectedDetail.node.id, { story: newStory });
    }
    setEditingStory(false);
  }, [selectedDetail, updateAnchor]);

  const handleSuggest = useCallback(() => {
    const suggestions = suggestConnections(anchors, crossEdges, 0.15);
    const top = suggestions.slice(0, 3);
    top.forEach(s => {
      addCrossEdge({
        sourceAnchorId: s.sourceId, targetAnchorId: s.targetId,
        edgeType: 'CO_OCCURS_WITH', confidence: Math.min(0.95, 0.6 + s.similarity),
      });
    });
    setToast(top.length > 0
      ? `Added ${top.length} connection${top.length === 1 ? '' : 's'} from text similarity`
      : 'No new connections found');
    setTimeout(() => setToast(null), 2800);
  }, [anchors, crossEdges, addCrossEdge]);

  // Save handler — bakes current layout positions into node data
  const handleSave = useCallback(async () => {
    const ok = await saveSeed(worldPos);
    setToast(ok ? 'Saved' : 'Save failed');
    setTimeout(() => setToast(null), 2000);
  }, [saveSeed, worldPos]);

  // Keyboard shortcuts: ESC, Ctrl+Z, Ctrl+Shift+Z, Ctrl+S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setConnectFromId(null);
        setEditingLabel(false);
        setEditingStory(false);
        setSelectedEdgeId(null);
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, handleSave]);

  /* ── Mount: resize observer + pan/zoom event handlers ─────────────────────── */

  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    function resize() {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      if (!w || !h) return;
      sizeRef.current = { w, h };
      forceUpdate();
    }
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(container);

    let isPanning = false;
    let lastX = 0, lastY = 0;

    function onDown(e: MouseEvent) {
      if (e.button !== 0) return;
      const target = e.target as SVGElement;
      if (target.closest('.station-group')) return;
      isPanning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      svg!.style.cursor = 'grabbing';
    }

    function onMove(e: MouseEvent) {
      if (!isPanning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const z = zoomRef.current;
      panRef.current = {
        x: panRef.current.x - dx / (SCALE * z),
        y: panRef.current.y - dy / (SCALE * z),
      };
      lastX = e.clientX;
      lastY = e.clientY;
      requestRedraw();
    }

    function onUp() {
      isPanning = false;
      svg!.style.cursor = connectFromId ? 'crosshair' : 'grab';
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= window.innerHeight;
      const sensitivity = e.ctrlKey ? 0.012 : 0.0018;
      const factor = Math.exp(-delta * sensitivity);
      const rect = svg!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { w, h } = sizeRef.current;
      const oldZ = zoomRef.current;
      const newZ = Math.max(0.25, Math.min(6, oldZ * factor));
      const wx = (mx - w / 2) / (SCALE * oldZ) + panRef.current.x;
      const wy = (my - h / 2) / (SCALE * oldZ) + panRef.current.y;
      panRef.current = {
        x: wx - (mx - w / 2) / (SCALE * newZ),
        y: wy - (my - h / 2) / (SCALE * newZ),
      };
      zoomRef.current = newZ;
      requestRedraw();
    }

    svg.style.cursor = 'grab';
    svg.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      obs.disconnect();
      svg.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      svg.removeEventListener('wheel', onWheel);
      if (inputRafRef.current !== null) cancelAnimationFrame(inputRafRef.current);
      if (posAnimRef.current !== null) cancelAnimationFrame(posAnimRef.current);
    };
  }, [requestRedraw, connectFromId]);

  useEffect(() => {
    if (svgRef.current) svgRef.current.style.cursor = connectFromId ? 'crosshair' : 'grab';
  }, [connectFromId]);

  /* ── Double-click to create new stop ──────────────────────────────────────── */

  const handleSvgDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as SVGElement;
    if (target.closest('.station-group')) return;
    const newId = createNew({ parentId: null, level: 'points', label: 'New stop' });
    onNodeClick(newId);
    setEditingLabel(true);
  }, [createNew, onNodeClick]);

  /* ── Zoom controls ────────────────────────────────────────────────────────── */

  const zoomIn = useCallback(() => { zoomRef.current = Math.min(6, zoomRef.current * 1.3); requestRedraw(); }, [requestRedraw]);
  const zoomOut = useCallback(() => { zoomRef.current = Math.max(0.25, zoomRef.current * 0.77); requestRedraw(); }, [requestRedraw]);
  const resetView = useCallback(() => { zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; requestRedraw(); }, [requestRedraw]);

  /* ── Render data prep ─────────────────────────────────────────────────────── */

  const z = zoomRef.current;
  const { w, h } = sizeRef.current;

  const drawOrder = useMemo(() => {
    const order = { stories: 0, points: 1, aspects: 2, parts: 3 } as Record<string, number>;
    return [...anchors].sort((a, b) => (order[a.level] ?? 0) - (order[b.level] ?? 0));
  }, [anchors]);

  const cityList = useMemo(() => {
    return anchors
      .filter(n => n.level === 'parts')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(p => ({ id: p.id, label: p.label, color: partColor.get(p.id) ?? ORPHAN_COLOR }));
  }, [anchors, partColor]);

  /* ── Detail panel positioning (anchored to selected node) ─────────────────── */

  let panelTop = 0, panelLeft = 0, arrowX = PANEL_W / 2, arrowAbove = true;
  if (selectedDetail) {
    const pos = getPos(selectedDetail.node.id);
    if (pos) {
      const [sx, sy] = w2s(pos.x, pos.y);
      const r = stationRadius(selectedDetail.node.level, z) * 1.18; // scaled-up selected size
      const GAP = 18;
      panelLeft = sx - PANEL_W / 2;
      panelTop = sy + r + GAP;
      arrowAbove = true;
      // Flip above if would overflow bottom
      if (panelTop + PANEL_H_EST > h - 20) {
        panelTop = sy - r - GAP - PANEL_H_EST;
        arrowAbove = false;
      }
      // Constrain horizontally
      if (panelLeft < 16) panelLeft = 16;
      if (panelLeft + PANEL_W > w - 16) panelLeft = w - PANEL_W - 16;
      arrowX = sx - panelLeft;
      arrowX = Math.max(16, Math.min(PANEL_W - 16, arrowX));
    }
  }

  /* ── HUD styles ───────────────────────────────────────────────────────────── */

  const panelCss: React.CSSProperties = {
    background: 'rgba(255,255,253,0.97)', border: `1px solid ${BORDER}`,
    backdropFilter: 'blur(8px)', padding: '14px 16px', borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  };
  const btnCss: React.CSSProperties = {
    width: 32, height: 32, background: '#fff', border: `1px solid ${BORDER}`,
    color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontFamily: SANS, fontSize: 16, borderRadius: 4,
  };
  const actionBtnCss = (variant: 'default' | 'primary' | 'danger' = 'default'): React.CSSProperties => ({
    flex: 1, padding: '6px 10px', fontSize: 11, fontWeight: 500,
    fontFamily: SANS, borderRadius: 4, cursor: 'pointer',
    border: variant === 'primary' ? `1px solid ${ACCENT}` : variant === 'danger' ? '1px solid #d04545' : `1px solid ${BORDER}`,
    background: variant === 'primary' ? ACCENT : '#fff',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#c03030' : '#444',
    transition: 'background 0.12s, border-color 0.12s',
  });

  const connectFromNode = connectFromId ? byId.get(connectFromId) : null;

  /* ── Render ───────────────────────────────────────────────────────────────── */

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', background: BG, overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width={w}
        height={h}
        onDoubleClick={handleSvgDoubleClick}
        style={{ position: 'absolute', inset: 0, display: 'block', userSelect: 'none' }}
      >
        <defs>
          <pattern id="dotgrid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="0.8" fill="#e5e3dc" />
          </pattern>
          {cities.map(c => (
            <radialGradient id={`halo-${c.id}`} key={c.id}>
              <stop offset="0%" stopColor={c.color} stopOpacity="0.10" />
              <stop offset="60%" stopColor={c.color} stopOpacity="0.04" />
              <stop offset="100%" stopColor={c.color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        <style>{`
          .station-group { cursor: pointer; }
          .station-shape {
            transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform-origin: 0 0;
          }
          .station-group:hover .station-shape:not(.is-selected) {
            transform: scale(1.10);
          }
          .station-shape.is-selected { transform: scale(1.18); }
          .station-shape.is-new {
            animation: station-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          @keyframes station-pop {
            from { transform: scale(0); }
            to { transform: scale(1); }
          }
          .edge-line {
            transition: stroke-width 0.18s, opacity 0.18s;
          }
          .edge-line.is-new {
            animation: edge-draw 0.6s ease-out;
          }
          @keyframes edge-draw {
            from { stroke-dashoffset: 100; opacity: 0; }
            to { stroke-dashoffset: 0; opacity: 1; }
          }
          @keyframes panel-pop {
            from { opacity: 0; transform: scale(0.92); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes path-dash {
            to { stroke-dashoffset: -24; }
          }
          .path-glow {
            animation: path-dash 0.8s linear infinite;
          }
        `}</style>

        <rect
          width={w}
          height={h}
          fill="url(#dotgrid)"
          onClick={() => onBackgroundClick?.()}
          style={{ cursor: 'crosshair' }}
        />

        {/* City halos */}
        {cities.map(c => {
          const hub = getPos(c.id);
          if (!hub) return null;
          const [hx, hy] = w2s(hub.x, hub.y);
          const r = c.r * SCALE * z + 35;
          return (
            <circle key={`halo-${c.id}`} cx={hx} cy={hy} r={r} fill={`url(#halo-${c.id})`} pointerEvents="none" />
          );
        })}

        {/* Transfer corridors */}
        {crossEdges.map(edge => {
          const sp = getPos(edge.sourceAnchorId);
          const tp = getPos(edge.targetAnchorId);
          if (!sp || !tp) return null;
          const [sx, sy] = w2s(sp.x, sp.y);
          const [tx, ty] = w2s(tp.x, tp.y);
          const mx = (sx + tx) / 2, my = (sy + ty) / 2;
          const dxe = tx - sx, dye = ty - sy;
          const cpx = mx + (-dye * 0.18);
          const cpy = my + (dxe * 0.18);
          const isSelEdge = edge.id === selectedEdgeId;
          const d = `M ${sx} ${sy} Q ${cpx} ${cpy} ${tx} ${ty}`;
          return (
            <g key={edge.id} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setSelectedEdgeId(isSelEdge ? null : edge.id); onBackgroundClick?.(); }}>
              {/* Fat invisible hit area */}
              <path d={d} stroke="transparent" strokeWidth="12" fill="none" />
              <path
                d={d}
                stroke={isSelEdge ? ACCENT : 'rgba(60,60,60,0.55)'}
                strokeWidth={isSelEdge ? 2 : 0.8 + edge.confidence * 1.4}
                strokeDasharray="5 4"
                fill="none"
                opacity={isSelEdge ? 1 : 0.3 + edge.confidence * 0.7}
              />
            </g>
          );
        })}

        {/* Metro lines */}
        {anchors.map(a => {
          if (!a.parentId || a.parentId === WORLD_NODE_ID) return null;
          const ap = getPos(a.id);
          const pp = getPos(a.parentId);
          if (!ap || !pp) return null;
          const color = nodeColorOf(a.id);
          const [ax, ay] = w2s(ap.x, ap.y);
          const [px, py] = w2s(pp.x, pp.y);
          const lw = a.level === 'aspects' ? 5 : a.level === 'points' ? 4 : 3;
          return (
            <path
              key={`line-${a.id}`}
              d={metroPath(px, py, ax, ay)}
              stroke={color}
              strokeWidth={lw}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              pointerEvents="none"
            />
          );
        })}

        {/* Connect-mode preview */}
        {connectFromId && (() => {
          const sp = getPos(connectFromId);
          if (!sp) return null;
          const [sx, sy] = w2s(sp.x, sp.y);
          if (!hoveredId || hoveredId === connectFromId) return null;
          const tp = getPos(hoveredId);
          if (!tp) return null;
          const [tx, ty] = w2s(tp.x, tp.y);
          return (
            <path
              d={`M ${sx} ${sy} L ${tx} ${ty}`}
              stroke={ACCENT}
              strokeWidth="2.5"
              strokeDasharray="6 4"
              fill="none"
              pointerEvents="none"
              opacity="0.75"
            />
          );
        })()}

        {/* Path overlay */}
        {hasPath && highlightedPath && highlightedPath.length > 1 && (() => {
          const points: [number, number][] = [];
          for (const nid of highlightedPath) {
            const p = getPos(nid);
            if (p) points.push(w2s(p.x, p.y));
          }
          if (points.length < 2) return null;
          const d = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0]} ${pt[1]}`).join(' ');
          return (
            <>
              {/* Glow underneath */}
              <path d={d} stroke="#2979FF" strokeWidth="8" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" pointerEvents="none" />
              {/* Solid path */}
              <path d={d} stroke="#2979FF" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" pointerEvents="none" />
              {/* Animated dashes on top */}
              <path d={d} stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 16" className="path-glow" pointerEvents="none" />
            </>
          );
        })()}

        {/* Stations */}
        {drawOrder.map(a => {
          const p = getPos(a.id);
          if (!p) return null;
          const [sx, sy] = w2s(p.x, p.y);
          const color = nodeColorOf(a.id);
          const isSel = a.id === selectedNodeId;
          const isConnectSrc = a.id === connectFromId;
          const isConnectTarget = !!connectFromId && a.id !== connectFromId && a.id === hoveredId;
          const isSt = a.tier === 'st';
          const isNew = newIds.has(a.id);
          const isUnseen = unseenIds.has(a.id) && !isSel;
          const isOnPath = pathSet.has(a.id);
          const dimmed = hasPath && !isOnPath && !isSel;
          const r = stationRadius(a.level, z);

          let shape: JSX.Element;
          if (a.level === 'parts') {
            shape = (
              <>
                <circle r={r} fill={color} />
                <circle r={r * 0.62} fill="#fff" />
                <circle r={r * 0.30} fill={color} />
              </>
            );
          } else if (a.level === 'aspects') {
            shape = (
              <circle
                r={r}
                fill="#fff"
                stroke={color}
                strokeWidth={2.8}
                strokeDasharray={isSt ? '3 2' : undefined}
              />
            );
          } else if (a.level === 'points') {
            shape = (
              <circle
                r={r}
                fill={isSt ? '#fff' : color}
                stroke={color}
                strokeWidth={isSt ? 1.8 : 2}
                strokeDasharray={isSt ? '2 2' : undefined}
              />
            );
          } else {
            shape = <circle r={r} fill={color} opacity={isSt ? 0.5 : 0.85} />;
          }

          const shapeClasses = ['station-shape'];
          if (isSel) shapeClasses.push('is-selected');
          if (isNew) shapeClasses.push('is-new');

          return (
            <g
              key={`station-${a.id}`}
              className="station-group"
              transform={`translate(${sx}, ${sy})`}
              onClick={(e) => { e.stopPropagation(); handleStationClick(a.id); }}
              onMouseEnter={() => setHoveredId(a.id)}
              onMouseLeave={() => setHoveredId(prev => prev === a.id ? null : prev)}
              style={{ opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.3s' }}
            >
              <g className={shapeClasses.join(' ')}>
                {shape}
              </g>
              {isSel && (
                <circle r={r * 1.9} fill="none" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="4 3">
                  <animate attributeName="r" values={`${r * 1.7};${r * 2.2};${r * 1.7}`} dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.55;0.2;0.55" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              {isUnseen && (
                <>
                  <circle r={r * 2.2} fill={NEW_PULSE} opacity="0.12">
                    <animate attributeName="r" values={`${r * 1.9};${r * 2.8};${r * 1.9}`} dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.18;0.04;0.18" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                  <circle r={r * 1.6} fill="none" stroke={NEW_PULSE} strokeWidth="1.8">
                    <animate attributeName="r" values={`${r * 1.4};${r * 2.0};${r * 1.4}`} dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.85;0.25;0.85" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
              {isConnectSrc && (
                <circle r={r * 2.1} fill="none" stroke={ACCENT} strokeWidth="2" strokeDasharray="3 3" opacity="0.7" />
              )}
              {isConnectTarget && (
                <circle r={r * 1.7} fill="none" stroke={ACCENT} strokeWidth="2" />
              )}
            </g>
          );
        })}

        {/* Labels */}
        {drawOrder.map(a => {
          const p = getPos(a.id);
          if (!p) return null;
          const [sx, sy] = w2s(p.x, p.y);
          const color = nodeColorOf(a.id);
          const isSel = a.id === selectedNodeId;
          const isHover = a.id === hoveredId;
          const isSt = a.tier === 'st';
          const isOnPath = pathSet.has(a.id);
          const dimmedLabel = hasPath && !isOnPath && !isSel;
          const r = stationRadius(a.level, z);

          const alwaysShow = a.level === 'parts' || isSel || isHover || isOnPath;
          if (!alwaysShow) {
            if (a.level === 'aspects' && z < 0.7) return null;
            if (a.level === 'points' && z < 1.0) return null;
            if (a.level === 'stories' && z < 1.4) return null;
          }

          const fontSize = a.level === 'parts' ? 14 : a.level === 'aspects' ? 11 : a.level === 'points' ? 10 : 9;
          const weight = a.level === 'parts' ? 700 : a.level === 'aspects' ? 600 : 400;
          const fill = isSel ? ACCENT : a.level === 'parts' ? color : isSt ? '#888' : TEXT;
          const lx = sx + r * (isSel ? 1.18 : isHover ? 1.10 : 1) + 7;
          const ly = sy;

          return (
            <g key={`label-${a.id}`} style={{ pointerEvents: 'none', transition: 'opacity 0.18s', opacity: dimmedLabel ? 0.15 : 1 }}>
              <text
                x={lx} y={ly}
                fontSize={fontSize} fontWeight={weight} fontFamily={SANS}
                fill={fill}
                stroke={BG} strokeWidth={3} strokeLinejoin="round"
                paintOrder="stroke fill"
                dominantBaseline="middle"
              >
                {a.label}
              </text>
              {a.level === 'parts' && (
                <line
                  x1={lx} y1={ly + fontSize / 2 + 2}
                  x2={lx + a.label.length * fontSize * 0.55}
                  y2={ly + fontSize / 2 + 2}
                  stroke={isSel ? ACCENT : color}
                  strokeWidth={1.2}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* ── Top brand ── */}
      <div style={{
        position: 'absolute', top: 16, left: 20, zIndex: 10, pointerEvents: 'none',
        fontFamily: SANS, fontSize: 11, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase',
        color: '#666',
      }}>
        {'{{PROJECT_NAME}}'} &middot; Cognitive Map
      </div>

      {/* ── Connect-mode banner ── */}
      {connectFromId && connectFromNode && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 11,
          ...panelCss, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: SANS, fontSize: 12, animation: 'panel-pop 0.2s ease-out',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT }} />
          <span><strong>Connect mode</strong> — click another station to link from <em>"{connectFromNode.label}"</em></span>
          <button
            onClick={() => setConnectFromId(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: DIM, padding: '0 4px', display: 'flex' }}
            title="Cancel (Esc)"
          ><span className="ms">close</span></button>
        </div>
      )}

      {/* ── Lines panel ── */}
      {cityList.length > 0 && (
        <div style={{ position: 'absolute', top: 16, right: 20, zIndex: 10, minWidth: 200, maxWidth: 240 }}>
          <div style={panelCss}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#aaa', marginBottom: 10 }}>
              Lines
            </div>
            {cityList.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <div style={{ width: 22, height: 4, background: c.color, borderRadius: 2, flexShrink: 0 }} />
                <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, color: TEXT, lineHeight: 1.2 }}>{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Detail panel — anchored to selected node ── */}
      <div
        style={{
          position: 'absolute',
          top: panelTop, left: panelLeft, width: PANEL_W,
          zIndex: 12,
          opacity: selectedDetail ? 1 : 0,
          transition: 'opacity 0.18s, top 0.22s cubic-bezier(0.4, 0, 0.2, 1), left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: selectedDetail ? 'auto' : 'none',
        }}
      >
        {/* Pointer arrow */}
        {selectedDetail && (arrowAbove ? (
          <div style={{
            position: 'absolute',
            top: -7, left: arrowX - 7,
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderBottom: '7px solid rgba(255,255,253,0.97)',
            filter: 'drop-shadow(0 -1px 1px rgba(0,0,0,0.04))',
          }} />
        ) : (
          <div style={{
            position: 'absolute',
            bottom: -7, left: arrowX - 7,
            width: 0, height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: '7px solid rgba(255,255,253,0.97)',
            filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.04))',
          }} />
        ))}

        <div style={panelCss}>
          {selectedDetail && (() => {
            const { node, cityLabel, cityColor } = selectedDetail;
            const role = ROLE[node.level] ?? 'Stop';
            const state = STATE[node.tier] ?? '';
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#aaa', marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cityColor }} />
                  <span>{role} · {state}</span>
                </div>

                {editingLabel ? (
                  <input
                    autoFocus
                    defaultValue={node.label}
                    onBlur={(e) => handleLabelSave(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingLabel(false);
                    }}
                    style={{
                      width: '100%', fontFamily: SANS, fontSize: 15, fontWeight: 600, color: TEXT,
                      lineHeight: 1.3, marginBottom: 8, padding: '4px 6px',
                      border: `1px solid ${ACCENT}`, borderRadius: 3, outline: 'none',
                    }}
                  />
                ) : (
                  <div
                    onClick={() => setEditingLabel(true)}
                    title="Click to rename"
                    style={{
                      fontFamily: SANS, fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 8,
                      lineHeight: 1.3, borderBottom: `1px solid ${BORDER}`, paddingBottom: 8, cursor: 'text',
                      transition: 'background 0.12s', borderRadius: 3, padding: '0 4px 8px',
                      marginLeft: -4, marginRight: -4,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(108,99,255,0.04)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {node.label}
                  </div>
                )}

                {editingStory ? (
                  <textarea
                    autoFocus
                    defaultValue={node.story ?? ''}
                    onBlur={(e) => handleStorySave(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingStory(false); }}
                    rows={4}
                    style={{
                      width: '100%', fontFamily: SANS, fontSize: 11, color: '#444', lineHeight: 1.55,
                      marginBottom: 10, padding: '4px 6px', border: `1px solid ${ACCENT}`,
                      borderRadius: 3, outline: 'none', resize: 'vertical',
                    }}
                  />
                ) : (
                  <div
                    onClick={() => setEditingStory(true)}
                    title="Click to add notes"
                    style={{
                      fontFamily: SANS, fontSize: 11, color: node.story ? '#444' : '#bbb', lineHeight: 1.55,
                      marginBottom: 10, cursor: 'text', minHeight: 18, padding: '2px 4px',
                      marginLeft: -4, marginRight: -4, borderRadius: 3, transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(108,99,255,0.04)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {node.story || 'Click to add notes…'}
                  </div>
                )}

                <div style={{ fontFamily: MONO, fontSize: 9, color: DIM, letterSpacing: 0.5, marginBottom: 12 }}>
                  Line: <span style={{ color: cityColor, fontWeight: 600 }}>{cityLabel}</span>
                </div>

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {node.level !== 'stories' && (
                    <button onClick={handleAddChild} style={{ ...actionBtnCss('default'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <span className="ms" style={{ fontSize: 14 }}>add</span>{ADD_LABEL[node.level] ?? 'Add stop'}
                    </button>
                  )}
                  <button
                    onClick={() => setConnectFromId(node.id)}
                    style={{ ...actionBtnCss(connectFromId === node.id ? 'primary' : 'default'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    disabled={!!connectFromId}
                  >
                    <span className="ms" style={{ fontSize: 14 }}>add_link</span>Connect
                  </button>
                  {node.tier === 'st' ? (
                    <button onClick={handleAnchor} style={{ ...actionBtnCss('primary'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <span className="ms" style={{ fontSize: 14 }}>anchor</span>Anchor
                    </button>
                  ) : (
                    <button onClick={handleDemote} style={{ ...actionBtnCss('default'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <span className="ms" style={{ fontSize: 14 }}>undo</span>Draft
                    </button>
                  )}
                  <button onClick={handleRemove} style={{ ...actionBtnCss('danger'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <span className="ms" style={{ fontSize: 14 }}>delete</span>Remove
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Hint */}
      {!selectedDetail && !connectFromId && anchors.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 64, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, pointerEvents: 'none',
          fontFamily: SANS, fontSize: 11, color: '#aaa',
        }}>
          Click a station to inspect · Double-click empty area to add a new stop · <span className="ms" style={{ fontSize: 13, verticalAlign: 'middle' }}>auto_awesome</span> to suggest connections
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20, zIndex: 10, pointerEvents: 'none',
        ...panelCss, padding: '10px 14px', minWidth: 160,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#aaa', marginBottom: 8 }}>
          Stations
        </div>
        {[
          { label: 'Hub', icon: <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#666', boxShadow: 'inset 0 0 0 3px #fff, inset 0 0 0 6px #666' }} /> },
          { label: 'Junction', icon: <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff', border: '2.5px solid #666' }} /> },
          { label: 'Stop', icon: <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#666', border: '2px solid #666' }} /> },
          { label: 'Marker', icon: <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#666' }} /> },
        ].map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', fontFamily: SANS, fontSize: 10, color: '#555' }}>
            <div style={{ width: 18, display: 'flex', justifyContent: 'center' }}>{it.icon}</div>
            <span>{it.label}</span>
          </div>
        ))}
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10, fontFamily: SANS, fontSize: 10, color: '#555' }}>
          <div style={{ width: 18, borderTop: '1.2px dashed #666' }} />
          <span>Transfer</span>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ position: 'absolute', bottom: 20, left: 20, display: 'flex', gap: 4, zIndex: 10, alignItems: 'center' }}>
        <div style={btnCss} onClick={zoomIn} title="Zoom in"><span className="ms">add</span></div>
        <div style={btnCss} onClick={zoomOut} title="Zoom out"><span className="ms">remove</span></div>
        <div style={btnCss} onClick={resetView} title="Reset view"><span className="ms">center_focus_strong</span></div>
        <div style={{ width: 1, height: 22, background: BORDER, margin: '0 6px' }} />
        <div
          style={{ ...btnCss, position: 'relative', color: isDirty ? ACCENT : '#666' }}
          onClick={handleSave}
          title="Save (Ctrl+S)"
        >
          <span className="ms">save</span>
          {isDirty && <div style={{ position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: '50%', background: '#FF6B35' }} />}
        </div>
        <div
          style={{ ...btnCss, opacity: canUndo ? 1 : 0.3, pointerEvents: canUndo ? 'auto' : 'none' }}
          onClick={undo}
          title="Undo (Ctrl+Z)"
        >
          <span className="ms">undo</span>
        </div>
        <div
          style={{ ...btnCss, opacity: canRedo ? 1 : 0.3, pointerEvents: canRedo ? 'auto' : 'none' }}
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <span className="ms">redo</span>
        </div>
        <div style={{ width: 1, height: 22, background: BORDER, margin: '0 6px' }} />
        <div style={btnCss} onClick={handleSuggest} title="Suggest connections from text similarity (top 3)"><span className="ms">auto_awesome</span></div>
      </div>

      {/* ── Edge detail panel ── */}
      {(() => {
        if (!selectedEdgeId) return null;
        const edge = crossEdges.find(e => e.id === selectedEdgeId);
        if (!edge) return null;
        const srcNode = byId.get(edge.sourceAnchorId);
        const tgtNode = byId.get(edge.targetAnchorId);
        const EDGE_TYPES = [
          'DEPENDS_ON', 'PRODUCES', 'VALIDATES', 'BLOCKS', 'IMPLEMENTS',
          'DOCUMENTS', 'RELATED_TO', 'MAPS_TO', 'OPERATIONALIZES',
          'CO_OCCURS_WITH', 'EXTENDS',
        ];
        return (
          <div style={{
            position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
            zIndex: 13, width: 340, ...panelCss,
            animation: 'panel-pop 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: '#aaa' }}>
                Transfer
              </div>
              <button onClick={() => setSelectedEdgeId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: DIM, padding: '0 2px', display: 'flex' }}><span className="ms">close</span></button>
            </div>
            <div style={{ fontFamily: SANS, fontSize: 12, color: TEXT, marginBottom: 10, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600 }}>{srcNode?.label ?? '?'}</span>
              <span style={{ color: DIM }}> → </span>
              <span style={{ fontWeight: 600 }}>{tgtNode?.label ?? '?'}</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#aaa', marginBottom: 6 }}>Relationship</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {EDGE_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => updateCrossEdge(edge.id, { edgeType: t })}
                    style={{
                      padding: '3px 8px', borderRadius: 4, fontFamily: MONO, fontSize: 9,
                      cursor: 'pointer', letterSpacing: 0.5,
                      border: `1px solid ${edge.edgeType === t ? ACCENT : BORDER}`,
                      background: edge.edgeType === t ? `rgba(108,99,255,0.08)` : '#fff',
                      color: edge.edgeType === t ? ACCENT : '#666',
                      fontWeight: edge.edgeType === t ? 600 : 400,
                    }}
                  >
                    {t.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: '#aaa' }}>Confidence</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: TEXT, fontWeight: 600 }}>{Math.round(edge.confidence * 100)}%</div>
              </div>
              <input
                type="range"
                min={0.5} max={1} step={0.05}
                value={edge.confidence}
                onChange={(e) => updateCrossEdge(edge.id, { confidence: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: ACCENT }}
              />
            </div>
            <button
              onClick={() => { removeCrossEdge(edge.id); setSelectedEdgeId(null); }}
              style={{ ...actionBtnCss('danger'), flex: 'none', width: '100%' }}
            >
              Remove transfer
            </button>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'absolute', bottom: 70, left: 20, zIndex: 11,
          ...panelCss, padding: '8px 14px',
          fontFamily: SANS, fontSize: 12, color: TEXT,
          animation: 'panel-pop 0.2s ease-out',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
