import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  listMine: vi.fn(),
  myVoices: vi.fn(),
}));

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    persona: { listMine: { query: mocks.listMine } },
    voiceLibrary: { myVoices: { query: mocks.myVoices } },
  },
}));
vi.mock('@/lib/wallet-auth', () => ({ useWalletAuth: () => ({ address: '0xabc' }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
// The heavy flows are covered elsewhere — stub them so we only test the hub.
vi.mock('../CreateLikenessFlow', () => ({
  CreateLikenessFlow: ({ onExit }: { onExit: () => void }) => (
    <button onClick={onExit}>likeness-flow</button>
  ),
}));
vi.mock('../ListPersonaForSaleDialog', () => ({
  ListPersonaForSaleDialog: ({ persona }: { persona: { name: string } }) => (
    <div>persona-dialog:{persona.name}</div>
  ),
}));
vi.mock('../ListVoiceForSaleDialog', () => ({
  ListVoiceForSaleDialog: ({ voice }: { voice: { name: string } }) => (
    <div>voice-dialog:{voice.name}</div>
  ),
}));

import { NewListingTab } from '../NewListingTab';

const persona = (id: string, name: string, meta: Record<string, unknown> = {}) => ({
  id,
  name,
  description: null,
  imageUrl: null,
  metadata: { origin: 'fictional', moderationStatus: 'not_required', ...meta },
});

function renderTab(listed: string[] = [], onListed = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NewListingTab listedEntityIds={new Set(listed)} onListed={onListed} />
    </QueryClientProvider>
  );
  return { onListed };
}

describe('NewListingTab', () => {
  beforeEach(() => {
    mocks.listMine.mockReset().mockResolvedValue([]);
    mocks.myVoices.mockReset().mockResolvedValue([]);
  });

  it('opens the embedded likeness flow and returns from it', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: /upload my likeness/i }));
    await userEvent.click(screen.getByText('likeness-flow'));
    expect(screen.getByRole('button', { name: /upload my likeness/i })).toBeTruthy();
  });

  it('lists characters, marks already-listed ones, and blocks moderation-pending ones', async () => {
    mocks.listMine.mockResolvedValue([
      persona('p1', 'Captain Vex'),
      persona('p2', 'Already Out'),
      persona('p3', 'Parody Guy', { origin: 'parody', moderationStatus: 'pending_review' }),
    ]);
    renderTab(['p2']);

    await screen.findByText('Captain Vex');
    // p2 is listed → no List button for it; p3 is in review → disabled.
    const listButtons = screen.getAllByRole('button', { name: /^list$/i });
    expect(listButtons).toHaveLength(2);
    expect((listButtons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((listButtons[1] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Listed')).toBeTruthy();

    await userEvent.click(listButtons[0]);
    expect(screen.getByText('persona-dialog:Captain Vex')).toBeTruthy();
  });

  it('offers cloned/designed voices but never curated library voices', async () => {
    mocks.myVoices.mockResolvedValue([
      { id: 'v1', name: 'My Clone', source: 'clone' },
      { id: 'v2', name: 'Catalog Voice', source: 'library' },
    ]);
    renderTab();

    await screen.findByText('My Clone');
    expect(screen.queryByText('Catalog Voice')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /^list$/i })[0]);
    await waitFor(() => expect(screen.getByText('voice-dialog:My Clone')).toBeTruthy());
  });

  it('shows the empty state when there are no characters', async () => {
    renderTab();
    expect(await screen.findByText(/haven't created a character yet/i)).toBeTruthy();
  });
});
