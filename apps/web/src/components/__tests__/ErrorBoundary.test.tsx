/**
 * Component tests for ErrorBoundary — catches a throwing subtree and renders
 * a fallback instead of crashing the app.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom({ message = 'kaboom' }: { message?: string }): JSX.Element {
  throw new Error(message);
}

// React logs caught render errors to console.error; silence just those.
afterEach(() => vi.restoreAllMocks());
const silenceReactErrorLog = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">fine</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });

  it('renders the default fallback when a child throws', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go Home/i })).toHaveAttribute('href', '/');
  });

  it('surfaces the error message in the details block', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary>
        <Boom message="ipfs gateway exploded" />
      </ErrorBoundary>
    );
    expect(screen.getByText('ipfs gateway exploded')).toBeInTheDocument();
  });

  it('renders a custom fallback instead of the default', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">nope</div>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('"Try Again" clears the error and re-renders the subtree', async () => {
    silenceReactErrorLog();
    const u = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('first time only');
      return <div data-testid="recovered">recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    await u.click(screen.getByRole('button', { name: /Try Again/i }));
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });
});
