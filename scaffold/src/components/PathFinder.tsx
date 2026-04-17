import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MemoryNode } from '../types';
import type { PathResult } from '../map/pathfinding';
import { SANS, MONO, BORDER, ACCENT, PATH_COLOR, BG_ALPHA as BG } from '../constants';

interface Props {
  nodes: MemoryNode[];
  hubColors: Map<string, string>;
  findHub: (nodeId: string) => string | null;
  result: PathResult | null;
  onFindPath: (fromId: string, toId: string) => void;
  onClear: () => void;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

function matchScore(node: MemoryNode, q: string): number {
  const lower = q.toLowerCase();
  const label = node.label.toLowerCase();
  const story = (node.story ?? '').toLowerCase();
  if (label === lower) return 100;
  if (label.startsWith(lower)) return 80;
  if (label.includes(lower)) return 60;
  if (story.includes(lower)) return 30;
  return 0;
}

/* ── Autocomplete input ──────────────────────────────────────────────────── */

function NodeInput({
  nodes, hubColors, findHub, value, onChange, placeholder,
}: {
  nodes: MemoryNode[];
  hubColors: Map<string, string>;
  findHub: (id: string) => string | null;
  value: string | null;
  onChange: (nodeId: string | null) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedNode = value ? nodes.find(n => n.id === value) : null;

  const results = useMemo(() => query.length >= 1
    ? nodes
        .map(n => ({ node: n, score: matchScore(n, query) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
        .map(r => r.node)
    : [],
  [nodes, query]);

  const handleSelect = useCallback((nodeId: string) => {
    onChange(nodeId);
    setQuery('');
    setOpen(false);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[activeIdx]) { handleSelect(results[activeIdx].id); }
    else if (e.key === 'Escape') { setOpen(false); }
  }, [results, activeIdx, handleSelect]);

  useEffect(() => { setActiveIdx(0); }, [results.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const clear = () => { onChange(null); setQuery(''); };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: '#f8f8f6', border: `1px solid ${BORDER}`, borderRadius: 6,
        padding: '6px 10px',
      }}>
        {selectedNode ? (
          <>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: hubColors.get(findHub(selectedNode.id) ?? '') ?? '#999',
            }} />
            <span style={{ flex: 1, fontFamily: SANS, fontSize: 12, color: '#333', fontWeight: 500 }}>
              {selectedNode.label}
            </span>
            <button onClick={clear} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#999',
              padding: 0, display: 'flex',
            }}><span className="ms" style={{ fontSize: 16 }}>close</span></button>
          </>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: SANS, fontSize: 12, color: '#333',
            }}
          />
        )}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
          background: BG, border: `1px solid ${BORDER}`, borderRadius: 6,
          boxShadow: '0 6px 18px rgba(0,0,0,0.12)', overflow: 'hidden',
          maxHeight: 200, overflowY: 'auto', zIndex: 110,
        }}>
          {results.map((n, i) => {
            const hub = findHub(n.id);
            const color = hub ? hubColors.get(hub) ?? '#999' : '#999';
            return (
              <div
                key={n.id}
                onClick={() => handleSelect(n.id)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  cursor: 'pointer',
                  background: i === activeIdx ? 'rgba(108,99,255,0.06)' : 'transparent',
                  borderBottom: i < results.length - 1 ? `1px solid ${BORDER}` : 'none',
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ fontFamily: SANS, fontSize: 12, color: '#333' }}>{n.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── PathFinder panel ─────────────────────────────────────────────────────── */

export default function PathFinder({
  nodes, hubColors, findHub, result, onFindPath, onClear, onClose, onSelectNode,
}: Props) {
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);

  const swap = () => { setFromId(toId); setToId(fromId); onClear(); };
  const canFind = fromId && toId && fromId !== toId;

  const handleFind = () => {
    if (canFind) onFindPath(fromId, toId);
  };

  const handleClear = () => { setFromId(null); setToId(null); onClear(); };

  return (
    <div style={{ width: 340 }}>
      {/* Main panel */}
      <div style={{
        background: BG, border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: '14px 16px', backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ms" style={{ fontSize: 16, color: PATH_COLOR }}>route</span>
            <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: '#333' }}>
              Find Route
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#999',
              fontSize: 16, padding: '0 2px', lineHeight: 1,
            }}
          >
            <span className="ms" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        {/* From / To inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              border: `2px solid ${PATH_COLOR}`, flexShrink: 0,
            }} />
            <div style={{ flex: 1 }}>
              <NodeInput
                nodes={nodes} hubColors={hubColors} findHub={findHub}
                value={fromId} onChange={setFromId} placeholder="From..."
              />
            </div>
          </div>

          {/* Swap button */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={swap}
              title="Swap"
              style={{
                background: '#f5f5f3', border: `1px solid ${BORDER}`, borderRadius: 4,
                width: 28, height: 22, cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12,
              }}
            >
              <span className="ms" style={{ fontSize: 16 }}>swap_vert</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: PATH_COLOR, flexShrink: 0,
            }} />
            <div style={{ flex: 1 }}>
              <NodeInput
                nodes={nodes} hubColors={hubColors} findHub={findHub}
                value={toId} onChange={setToId} placeholder="To..."
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleFind}
            disabled={!canFind}
            style={{
              flex: 1, padding: '8px 12px', border: 'none', borderRadius: 6,
              fontFamily: SANS, fontSize: 12, fontWeight: 600, cursor: canFind ? 'pointer' : 'default',
              background: canFind ? PATH_COLOR : '#e0e0e0',
              color: canFind ? '#fff' : '#999',
              transition: 'background 0.15s',
            }}
          >
            Find Path
          </button>
          {result && (
            <button
              onClick={handleClear}
              style={{
                padding: '8px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
                fontFamily: SANS, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                background: '#fff', color: '#666',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Route steps */}
      {result && (
        <div style={{
          marginTop: 6, background: BG, border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: '12px 16px', backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {!result.found ? (
            <div style={{ fontFamily: SANS, fontSize: 12, color: '#999', textAlign: 'center', padding: '8px 0' }}>
              No path found between these nodes
            </div>
          ) : (
            <>
              <div style={{
                fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
                color: '#aaa', marginBottom: 10,
              }}>
                Route &middot; {result.path.length - 1} hop{result.path.length - 1 !== 1 ? 's' : ''}
              </div>
              {result.steps.map((step, i) => {
                const node = nodes.find(n => n.id === step.nodeId);
                if (!node) return null;
                const hub = findHub(node.id);
                const color = hub ? hubColors.get(hub) ?? '#999' : '#999';
                const isFirst = i === 0;
                const isLast = i === result.steps.length - 1;
                return (
                  <div key={step.nodeId} style={{ position: 'relative', paddingLeft: 24 }}>
                    {/* Vertical line */}
                    {!isLast && (
                      <div style={{
                        position: 'absolute', left: 7, top: 14, bottom: -2,
                        width: 2, background: result.steps[i + 1]?.edgeType === 'cross-edge' ? 'transparent' : color,
                        borderLeft: result.steps[i + 1]?.edgeType === 'cross-edge' ? `2px dashed ${PATH_COLOR}` : 'none',
                      }} />
                    )}
                    {/* Dot */}
                    <div style={{
                      position: 'absolute', left: 2, top: 5,
                      width: isFirst || isLast ? 12 : 8,
                      height: isFirst || isLast ? 12 : 8,
                      borderRadius: '50%',
                      background: isFirst || isLast ? PATH_COLOR : color,
                      border: isFirst || isLast ? `2px solid ${PATH_COLOR}` : `2px solid #fff`,
                      marginLeft: isFirst || isLast ? -2 : 0,
                      marginTop: isFirst || isLast ? -2 : 0,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                    }} />
                    {/* Content */}
                    <div
                      style={{
                        padding: '4px 8px 12px', cursor: 'pointer', borderRadius: 4,
                        transition: 'background 0.1s',
                      }}
                      onClick={() => onSelectNode(step.nodeId)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(41,121,255,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{
                        fontFamily: SANS, fontSize: 12, fontWeight: isFirst || isLast ? 600 : 400,
                        color: '#333',
                      }}>
                        {node.label}
                      </div>
                      {step.edgeType === 'cross-edge' && step.edgeLabel && (
                        <div style={{
                          fontFamily: MONO, fontSize: 9, color: PATH_COLOR, marginTop: 2,
                          letterSpacing: 0.5,
                        }}>
                          via {step.edgeLabel}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
