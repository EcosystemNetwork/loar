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
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  // Keep the error in state (not an instance field) so the fallback's
  // "Show error details" block actually renders on the first error — a plain
  // field set in componentDidCatch never triggers a re-render.
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('Uncaught error:', error);
    console.error('Component stack:', info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="min-h-svh flex items-center justify-center bg-background p-4">
            <div className="max-w-md w-full text-center space-y-6">
              <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-7 w-7 text-destructive" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-foreground">Something went wrong</h2>
                <p className="text-sm text-muted-foreground">
                  An unexpected error occurred. You can try again or return to the home page.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={this.handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </button>
                <a
                  href="/"
                  className="inline-flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Home className="h-4 w-4" />
                  Go Home
                </a>
              </div>
              {this.state.error && (
                <details className="text-left mt-4">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Show error details
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground bg-muted/50 p-3 rounded-lg overflow-auto max-h-[200px] border border-border">
                    {this.state.error.message}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
