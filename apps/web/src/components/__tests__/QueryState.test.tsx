/**
 * Component tests for QueryState — the loading / error / empty / success
 * wrapper used across every data-fetching page.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryState } from '../QueryState';

const base = {
  isLoading: false,
  isError: false,
  children: <div data-testid="content">the data</div>,
};

describe('QueryState — state selection', () => {
  it('renders children on success', () => {
    render(<QueryState {...base} />);
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders a skeleton grid of `skeletonCount` cards while loading', () => {
    const { container } = render(<QueryState {...base} isLoading skeletonCount={5} />);
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    expect((container.firstChild as HTMLElement).childElementCount).toBe(5);
  });

  it('honours a custom loadingState', () => {
    render(<QueryState {...base} isLoading loadingState={<div data-testid="custom-load" />} />);
    expect(screen.getByTestId('custom-load')).toBeInTheDocument();
  });

  it('renders the error block with the default copy', () => {
    render(<QueryState {...base} isError />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/Failed to load data/)).toBeInTheDocument();
  });

  it('uses a custom errorMessage', () => {
    render(<QueryState {...base} isError errorMessage="Ponder is down" />);
    expect(screen.getByText('Ponder is down')).toBeInTheDocument();
  });

  it('only shows Try Again when onRetry is provided, and calls it', async () => {
    const u = userEvent.setup();
    const { rerender } = render(<QueryState {...base} isError />);
    expect(screen.queryByRole('button', { name: /Try Again/i })).not.toBeInTheDocument();

    const onRetry = vi.fn();
    rerender(<QueryState {...base} isError onRetry={onRetry} />);
    await u.click(screen.getByRole('button', { name: /Try Again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders emptyState when isEmpty', () => {
    render(
      <QueryState {...base} isEmpty emptyState={<div data-testid="empty">nothing here</div>} />
    );
    expect(screen.getByTestId('empty')).toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('renders nothing for isEmpty with no emptyState', () => {
    const { container } = render(<QueryState {...base} isEmpty />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('QueryState — precedence', () => {
  it('loading wins over error and empty', () => {
    render(
      <QueryState
        {...base}
        isLoading
        isError
        isEmpty
        emptyState={<div data-testid="empty" />}
        loadingState={<div data-testid="load" />}
      />
    );
    expect(screen.getByTestId('load')).toBeInTheDocument();
    expect(screen.queryByTestId('empty')).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('error wins over empty and children', () => {
    render(<QueryState {...base} isError isEmpty emptyState={<div data-testid="empty" />} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByTestId('empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });
});
