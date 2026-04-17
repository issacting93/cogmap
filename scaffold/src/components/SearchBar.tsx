import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MemoryNode } from '../types';
import { SANS, MONO, BORDER, ACCENT, BG_ALPHA as BG } from '../constants';

interface Props {
  nodes: MemoryNode[];
  hubColors: Map<string, string>;
  findHub: (nodeId: string) => string | null;
  onSelect: (nodeId: string) => void;
  onStartPath: () => void;
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

export default function SearchBar({ nodes, hubColors, findHub, onSelect, onStartPath }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => query.length >= 1
    ? nodes
        .map(n => ({ node: n, score: matchScore(n, query) }))
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    : [],
  [nodes, query]);

  const handleSelect = useCallback((nodeId: string) => {
    onSelect(nodeId);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }, [onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIdx]) {
      handleSelect(results[activeIdx].node.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }, [results, activeIdx, handleSelect]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset active index when results change
  useEffect(() => { setActiveIdx(0); }, [results.length]);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const levelIcon: Record<string, string> = {
    parts: '\u25C9', // ◉
    aspects: '\u25CB', // ○
    points: '\u2022', // •
    stories: '\u00B7', // ·
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: 340 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: BG, border: `1px solid ${BORDER}`, borderRadius: 8,
        padding: '8px 12px', backdropFilter: 'blur(8px)',
        boxShadow: open ? '0 4px 20px rgba(0,0,0,0.10)' : '0 2px 8px rgba(0,0,0,0.05)',
        transition: 'box-shadow 0.2s',
      }}>
        <span className="ms" style={{ fontSize: 16, color: '#999' }}>search</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search nodes...  /"
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: SANS, fontSize: 13, color: '#333',
          }}
        />
        <button
          onClick={onStartPath}
          title="Find path between nodes"
          style={{
            background: 'none', border: `1px solid ${BORDER}`, borderRadius: 4,
            padding: '3px 8px', cursor: 'pointer', fontFamily: SANS, fontSize: 11,
            color: '#666', display: 'flex', alignItems: 'center', gap: 4,
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = '#666'; }}
        >
          <span className="ms" style={{ fontSize: 14 }}>route</span>
          Route
        </button>
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: BG, border: `1px solid ${BORDER}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
          maxHeight: 320, overflowY: 'auto', zIndex: 100,
        }}>
          {results.map((r, i) => {
            const hub = findHub(r.node.id);
            const color = hub ? hubColors.get(hub) ?? '#999' : '#999';
            const isActive = i === activeIdx;
            return (
              <div
                key={r.node.id}
                onClick={() => handleSelect(r.node.id)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', cursor: 'pointer',
                  background: isActive ? 'rgba(108,99,255,0.06)' : 'transparent',
                  borderBottom: i < results.length - 1 ? `1px solid ${BORDER}` : 'none',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: color,
                  flexShrink: 0, opacity: 0.8,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: SANS, fontSize: 13, fontWeight: 500, color: '#222',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {r.node.label}
                  </div>
                  {r.node.story && (
                    <div style={{
                      fontFamily: SANS, fontSize: 10, color: '#888', marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {r.node.story}
                    </div>
                  )}
                </div>
                <div style={{
                  fontFamily: MONO, fontSize: 9, color: '#bbb', letterSpacing: 0.5,
                  textTransform: 'uppercase', flexShrink: 0,
                }}>
                  {levelIcon[r.node.level] ?? ''} {r.node.level}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && query.length >= 1 && results.length === 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: BG, border: `1px solid ${BORDER}`, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '16px 14px',
          fontFamily: SANS, fontSize: 12, color: '#999', textAlign: 'center',
        }}>
          No matching nodes
        </div>
      )}
    </div>
  );
}
