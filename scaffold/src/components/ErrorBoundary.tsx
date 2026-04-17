import { Component } from 'react';
import type { ReactNode } from 'react';
import { SANS, MONO, BORDER, ACCENT } from '../constants';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#fafaf7',
      }}>
        <div style={{
          maxWidth: 420, padding: '32px 36px', background: '#fff',
          border: `1px solid ${BORDER}`, borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center',
        }}>
          <span className="ms" style={{ fontSize: 36, marginBottom: 16, display: 'block', color: '#e0a000' }}>warning</span>
          <div style={{
            fontFamily: SANS, fontSize: 15, fontWeight: 600, color: '#222', marginBottom: 8,
          }}>
            Something went wrong
          </div>
          <div style={{
            fontFamily: MONO, fontSize: 11, color: '#999', marginBottom: 24,
            wordBreak: 'break-word',
          }}>
            {error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: '8px 20px', background: ACCENT, color: '#fff',
              border: 'none', borderRadius: 6, fontFamily: SANS, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
