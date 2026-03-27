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

  componentDidCatch(error: Error) {
    console.error('Uncaught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <h2>Something went wrong.</h2>
            <p>Please refresh the page and try again.</p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
