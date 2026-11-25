import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ buildPlan: vi.fn() }));
vi.mock('@/utils/trpc', () => ({
  trpcClient: { tripo: { buildPlan: { query: mocks.buildPlan } } },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/SmartImage', () => ({ SmartImage: () => null }));

import { BuildPicker, type BuildCandidate } from '../BuildPicker';

const row = (id: string, name: string) =>
  ({ id, name, kind: 'thing', imageUrl: null }) as unknown as BuildCandidate['row'];
const candidates: BuildCandidate[] = [
  { row: row('trinket', 'Brass Key'), cost: 0.4, output: '3D model' },
  { row: row('ship', 'Night Heron'), cost: 0.4, output: '3D model' },
  { row: row('dock', 'Dock Nine'), cost: 0.3, output: 'environment' },
];
const usage = (episodes: number, sets: number, mentions = 0) => ({
  episodes,
  sets,
  mentions,
  score: episodes * 3 + sets * 3 + mentions,
});

function renderPicker(onConfirm = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <BuildPicker
        open
        onOpenChange={vi.fn()}
        mode="build"
        universeId="0xuni"
        candidates={candidates}
        pending={false}
        onConfirm={onConfirm}
      />
    </QueryClientProvider>
  );
  return onConfirm;
}

describe('BuildPicker', () => {
  it('pre-selects only what episodes/sets use, and sends exactly the picks', async () => {
    mocks.buildPlan.mockResolvedValue({
      trinket: usage(0, 0, 2), // wiki mentions alone don't count as story use
      ship: usage(2, 1),
      dock: usage(1, 0),
    });
    const onConfirm = renderPicker();
    await screen.findByText('Used in your story (2)');
    expect(screen.getByText('Not used yet (1)')).toBeTruthy();
    expect(screen.getByText(/2 selected · ≈\$0\.70/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Build 2' }));
    expect(onConfirm).toHaveBeenCalledWith(['ship', 'dock']);
  });

  it('nothing is pre-selected when nothing is used, and Build is disabled', async () => {
    mocks.buildPlan.mockResolvedValue({});
    renderPicker();
    await screen.findByText('Not used yet (3)');
    expect(screen.getByRole('button', { name: 'Build 0' })).toHaveProperty('disabled', true);
  });

  it('lets the manager add an unused item by hand', async () => {
    mocks.buildPlan.mockResolvedValue({ ship: usage(1, 0) });
    const onConfirm = renderPicker();
    await screen.findByText('Used in your story (1)');
    await userEvent.click(screen.getByText('Brass Key'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build 2' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Build 2' }));
    expect(onConfirm).toHaveBeenCalledWith(['ship', 'trinket']);
  });
});
