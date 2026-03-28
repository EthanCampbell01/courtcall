import React from 'react';

/**
 * ErrorBoundary — catches any React rendering error and shows
 * a friendly recovery screen instead of a blank page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('React ErrorBoundary caught:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, background: '#080B10', color: '#ECF0F6', fontFamily: "'DM Sans', -apple-system, sans-serif",
        }}>
          <div style={{ maxWidth: 380, textAlign: 'center' }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
              background: 'linear-gradient(135deg, #FF4757, #FF6B6B)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
              boxShadow: '0 8px 32px rgba(255,71,87,0.2)',
            }}>
              😵
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: '#8494A7', lineHeight: 1.6, marginBottom: 28 }}>
              CourtCall hit an unexpected error. Try refreshing — if it keeps happening, let us know.
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
              style={{
                padding: '14px 28px', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #00E87B, #00C566)',
                color: '#080B10', fontSize: 15, fontWeight: 700,
                boxShadow: '0 4px 20px rgba(0,232,123,0.2)',
              }}
            >
              Back to Home
            </button>
            {import.meta.env?.DEV && this.state.error && (
              <pre style={{ marginTop: 20, padding: 12, background: '#1a1a24', borderRadius: 8, fontSize: 11, textAlign: 'left', overflow: 'auto', color: '#ef4444' }}>
                {this.state.error.toString()}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
