/**
 * Error Boundary
 *
 * React class component that catches unhandled errors in its subtree and
 * renders a fallback UI instead of crashing the whole app.
 *
 * @param children - Component tree to wrap
 * @param fallback - Optional custom fallback; defaults to a generic error message
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('Uncaught error:', error);
    console.error('Component stack:', info?.componentStack);
    this._error = error;
    this._info = info;
  }

  _error: Error | null = null;
  _info: any = null;

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h2>Something went wrong.</h2>
            <p>Please refresh the page and try again.</p>
            {this._error && (
              <details
                style={{
                  marginTop: '1rem',
                  textAlign: 'left',
                  maxWidth: '600px',
                  margin: '1rem auto',
                }}
              >
                <summary style={{ cursor: 'pointer', color: '#f87171' }}>Error details</summary>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.75rem',
                    background: '#1a1a1a',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    overflow: 'auto',
                    maxHeight: '300px',
                  }}
                >
                  {this._error.message}
                  {'\n\n'}
                  {this._error.stack}
                  {'\n\n'}Component Stack:{this._info?.componentStack}
                </pre>
              </details>
            )}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
