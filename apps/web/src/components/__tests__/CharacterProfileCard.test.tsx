import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
}));

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    entities: {
      characterProfile: { query: mocks.profile },
      update: { mutate: mocks.update },
      completeCharacterProfile: { mutate: mocks.complete },
    },
  },
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params, to: _to, ...rest }: any) => (
    <a href={`/episode/${params?.id}`} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/apiKeyGate', () => ({ requireProviderKey: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CharacterProfileCard } from '../wiki/CharacterProfileCard';

const field = (key: string, label: string, value = '') => ({
  key,
  label,
  hint: `hint ${key}`,
  value,
  filled: value !== '',
});

const profile = () => ({
  entityId: 'e1',
  name: 'Sable',
  summary: '',
  sections: [
    {
      id: 'identity',
      title: 'Identity',
      fields: [field('role', 'Role / Archetype', 'Protagonist'), field('age', 'Age')],
    },
    { id: 'history', title: 'History', fields: [field('backstory', 'Backstory')] },
  ],
  appearances: [{ id: 'ep1', title: 'Ep 1 — Fracture', snippet: 'Sable wakes.' }],
  extra: [{ key: 'catchphrase', value: 'Again.' }],
  completeness: {
    filled: 1,
    total: 3,
    percent: 33,
    missing: ['age', 'backstory'],
    hasDescription: true,
  },
  assets: [
    { key: 'portrait', label: 'Portrait', done: true },
    { key: 'relationships', label: 'Relationships', done: false, count: 0 },
  ],
});

function renderCard(isOwner: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CharacterProfileCard entityId="e1" metadata={{ role: 'Protagonist' }} isOwner={isOwner} />
    </QueryClientProvider>
  );
}

describe('CharacterProfileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue(profile());
  });

  it('shows only filled fields, extras and completeness to visitors', async () => {
    renderCard(false);
    expect(await screen.findByText('Protagonist')).toBeTruthy();
    expect(screen.queryByText('33%')).toBeNull();
    expect(screen.queryByText('Portrait')).toBeNull();
    expect(screen.getByText('Again.')).toBeTruthy();
    expect(screen.getByText('Ep 1 — Fracture').closest('a')?.getAttribute('href')).toBe(
      '/episode/ep1'
    );
    expect(screen.queryByText(/Add age/i)).toBeNull();
    expect(screen.queryByText(/Complete with AI/i)).toBeNull();
    expect(screen.queryByText('History')).toBeNull();
  });

  it('shows owners the completeness bar and asset checklist', async () => {
    renderCard(true);
    expect(await screen.findByText('33%')).toBeTruthy();
    expect(screen.getByText('Portrait')).toBeTruthy();
  });

  it('lets an owner add an empty field, merging into existing metadata', async () => {
    mocks.update.mockResolvedValue({ success: true });
    renderCard(true);
    await userEvent.click(await screen.findByText(/Add age/i));
    await userEvent.type(screen.getByPlaceholderText('hint age'), '900');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        entityId: 'e1',
        metadata: { role: 'Protagonist', age: '900' },
      })
    );
  });

  it('offers AI completion with the missing count and calls the mutation', async () => {
    mocks.complete.mockResolvedValue({ added: ['age'], entity: {} });
    renderCard(true);
    await userEvent.click(await screen.findByRole('button', { name: /Complete with AI \(2\)/ }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith({ entityId: 'e1' }));
  });
});
