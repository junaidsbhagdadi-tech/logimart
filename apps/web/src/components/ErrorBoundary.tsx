import React from 'react';

/** Catches any render/runtime error in the tree so the app shows a recoverable message instead of a
 *  blank white screen. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a breadcrumb in the console for debugging.
    // eslint-disable-next-line no-console
    console.error('App error:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 640, margin: '60px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ marginTop: 0 }}>⚠️ Something went wrong on this screen</h2>
          <p style={{ color: '#555' }}>The page hit an unexpected error, so it stopped instead of showing a blank screen. Your data is safe.</p>
          <pre style={{ background: '#f6f8fa', border: '1px solid #e1e4e8', borderRadius: 8, padding: 12, fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={() => this.setState({ error: null })} style={{ padding: '8px 16px' }}>Try again</button>
            <button onClick={() => { location.href = '/'; }} style={{ padding: '8px 16px' }}>Go to dashboard</button>
            <button onClick={() => location.reload()} style={{ padding: '8px 16px' }}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
