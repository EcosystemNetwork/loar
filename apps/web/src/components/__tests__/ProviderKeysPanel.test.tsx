import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  listKeys: vi.fn(),
  usage: vi.fn(),
  upsertKey: vi.fn(),
  setKeyEnabled: vi.fn(),
}));

vi.mock('@/utils/trpc', () => ({
  trpcClient: {
    providers: {
      listKeys: { query: mocks.listKeys },
      usage: { query: mocks.usage },
      upsertKey: { mutate: mocks.upsertKey },
      setKeyEnabled: { mutate: mocks.setKeyEnabled },
      testKey: { mutate: vi.fn() },
      deleteKey: { mutate: vi.fn() },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProviderKeysPanel } from '../settings/ProviderKeysPanel';

const key = (provider: string, over: Record<string, unknown> = {}) => ({
  provider,
  fingerprint: 'abcd1234',
  last4: 'wxyz',
  enabled: true,
  testedAt: new Date(),
  lastCheckStatus: 'valid',
  lastUsedAt: null,
  createdAt: new Date(),
  ...over,
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProviderKeysPanel />
    </QueryClientProvider>
  );
}

describe('ProviderKeysPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usage.mockResolvedValue({
      byProvider: [{ provider: 'fal', calls: 12, byokCalls: 12, totalCredits: 0 }],
    });
    mocks.listKeys.mockResolvedValue([
      key('fal'),
      key('openai', { enabled: false }),
      key('google', { lastCheckStatus: 'invalid' }),
    ]);
  });

  it('groups providers by category and shows status + attention banner', async () => {
    renderPanel();
    expect(await screen.findByText('Video & image')).toBeTruthy();
    expect(screen.getByText('Language models')).toBeTruthy();
    expect(screen.getByText('Transcription')).toBeTruthy();
    expect(screen.getByText(/2 keys need attention/)).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  it('filters to providers that need attention', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Video & image');
    await user.click(screen.getByRole('tab', { name: /Needs attention/ }));
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('Google AI (Imagen + Gemini)')).toBeTruthy();
    expect(screen.queryByText('fal.ai')).toBeNull();
    expect(screen.queryByText('Groq')).toBeNull();
  });

  it('searches providers by name', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Video & image');
    await user.type(screen.getByLabelText('Search providers'), 'groq');
    expect(screen.getByText('Groq')).toBeTruthy();
    expect(screen.queryByText('OpenAI')).toBeNull();
  });

  it('adds a key for a provider with none', async () => {
    mocks.upsertKey.mockResolvedValue({});
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Video & image');
    await user.type(screen.getByLabelText('Search providers'), 'groq');
    await user.click(screen.getByRole('button', { name: /Add key/ }));
    await user.type(screen.getByLabelText(/Add a key/), 'gsk_test_key_123');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(mocks.upsertKey).toHaveBeenCalledWith({ provider: 'groq', apiKey: 'gsk_test_key_123' })
    );
  });

  it('shows the masked key and call volume for a connected provider', async () => {
    renderPanel();
    await screen.findByText('Video & image');
    const fal = screen.getByText('fal.ai').closest('button') as HTMLElement;
    expect(within(fal).getByText('•••• wxyz')).toBeTruthy();
    expect(within(fal).getByText('12')).toBeTruthy();
  });
});
