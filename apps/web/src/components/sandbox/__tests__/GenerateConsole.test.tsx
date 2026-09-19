/**
 * Component tests for the /create GenerateConsole: publish wiring, retry gating,
 * per-wallet persistence, entity generation failure handling, 3D source rules.
 * Every network / wallet dependency is mocked; the console itself is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    toast: Object.assign(fn(), {
      error: fn(),
      success: fn(),
      message: fn(),
      warning: fn(),
    }),
    auth: { address: '0xAAA' as string | undefined },
    trpc: {
      image: { generate: { mutate: fn() } },
      generation: { generate: { mutate: fn() } },
      voice: {
        synthesize: { mutate: fn() },
        soundEffect: { mutate: fn() },
        listVoices: { query: fn() },
      },
      sandbox: {
        saveDraft: { mutate: fn() },
        promoteToUniverse: { mutate: fn() },
        myDrafts: { query: fn() },
        myPromotableUniverses: { query: fn() },
        deleteDraft: { mutate: fn() },
      },
      entities: { generateProfile: { mutate: fn() }, create: { mutate: fn() } },
    },
  };
});

vi.mock('sonner', () => ({ toast: m.toast }));
vi.mock('@/utils/trpc', () => ({ trpcClient: m.trpc }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: any) => <a href={String(to)}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/wallet-auth', () => ({
  useWalletAuth: () => ({
    isAuthenticated: true,
    isAuthenticating: false,
    address: m.auth.address,
  }),
}));
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ generationEnabled: true }),
}));
vi.mock('@/components/wallet-connect-button', () => ({ WalletConnectButton: () => null }));
vi.mock('@/components/ModelSelector', () => ({ ModelSelector: () => null }));
vi.mock('@/components/editing/VoiceModifyPanel', () => ({ VoiceModifyPanel: () => null }));
vi.mock('@/components/SmartImage', () => ({ SmartImage: (p: any) => <img alt="" src={p.src} /> }));

import { GenerateConsole } from '../GenerateConsole';
import { QUEUE_STORAGE_KEY } from '../constants';
import { scopedStorageKey } from '../utils';

function renderConsole(props: Partial<React.ComponentProps<typeof GenerateConsole>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GenerateConsole variant="console" enableWorldKinds {...props} />
    </QueryClientProvider>
  );
}

const typePrompt = (text: string) =>
  fireEvent.change(document.querySelector('textarea')!, { target: { value: text } });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  m.auth.address = '0xAAA';
  m.trpc.sandbox.myDrafts.query.mockResolvedValue([]);
  m.trpc.sandbox.myPromotableUniverses.query.mockResolvedValue([{ id: 'uni1', name: 'Uni One' }]);
  m.trpc.voice.listVoices.query.mockResolvedValue([{ voice_id: 'v1', name: 'Voice' }]);
  m.trpc.sandbox.saveDraft.mutate.mockResolvedValue({ id: 'draft1', contentId: 'c1' });
  m.trpc.sandbox.promoteToUniverse.mutate.mockResolvedValue({ contentId: 'c1', universeId: null });
});

describe('publish wiring', () => {
  it('an image run saves a draft and auto-promotes to My Gallery with the chosen visibility', async () => {
    m.trpc.image.generate.mutate.mockResolvedValue({ imageUrls: ['https://media.loar.fun/a.png'] });
    renderConsole();
    typePrompt('a red fox');
    fireEvent.click(screen.getByRole('button', { name: /generate image/i }));

    await waitFor(() => expect(m.trpc.sandbox.promoteToUniverse.mutate).toHaveBeenCalled());
    expect(m.trpc.image.generate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'a red fox', task: 'text_to_image' })
    );
    expect(m.trpc.sandbox.saveDraft.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'image', imageUrl: 'https://media.loar.fun/a.png' })
    );
    const promoteArg = m.trpc.sandbox.promoteToUniverse.mutate.mock.calls[0][0];
    expect(promoteArg).toMatchObject({
      draftId: 'draft1',
      visibility: 'unlisted',
      classification: 'fan',
    });
    expect(promoteArg.universeId).toBeUndefined();
  });

  it('clamps the saved draft prompt to the server limit of 2000 chars', async () => {
    m.trpc.image.generate.mutate.mockResolvedValue({ imageUrls: ['https://media.loar.fun/a.png'] });
    renderConsole();
    typePrompt('x'.repeat(2500));
    fireEvent.click(screen.getByRole('button', { name: /generate image/i }));
    await waitFor(() => expect(m.trpc.sandbox.saveDraft.mutate).toHaveBeenCalled());
    expect(m.trpc.sandbox.saveDraft.mutate.mock.calls[0][0].prompt).toHaveLength(2000);
  });
});

describe('retry gating', () => {
  it('failed image runs offer Retry', async () => {
    m.trpc.image.generate.mutate.mockRejectedValue(new Error('boom'));
    renderConsole();
    typePrompt('a fox');
    fireEvent.click(screen.getByRole('button', { name: /generate image/i }));
    expect(await screen.findByRole('button', { name: /retry \(2 left\)/i })).toBeInTheDocument();
  });

  it('failed sound-effect runs do NOT offer Retry (it would replay as a video job)', async () => {
    m.trpc.voice.soundEffect.mutate.mockRejectedValue(new Error('sfx down'));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: /^voice$/i }));
    fireEvent.click(screen.getByRole('button', { name: /sound effect/i }));
    typePrompt('thunder');
    fireEvent.click(screen.getAllByRole('button', { name: /generate sound effect/i })[0]);
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(m.trpc.generation.generate.mutate).not.toHaveBeenCalled();
  });
});

describe('per-wallet persistence', () => {
  const seed = (address: string, prompt: string) =>
    localStorage.setItem(
      scopedStorageKey(QUEUE_STORAGE_KEY, address),
      JSON.stringify([
        {
          id: 'g1',
          kind: 'image',
          prompt,
          status: 'done',
          imageUrl: 'https://media.loar.fun/a.png',
          imageSize: 'landscape_16_9',
          aspectRatio: '16:9',
          createdAt: Date.now(),
          draftId: 'd1',
        },
      ])
    );

  it("shows the current wallet's queue and never another wallet's", () => {
    seed('0xAAA', 'alice secret prompt');
    seed('0xBBB', 'bob secret prompt');
    m.auth.address = '0xBBB';
    renderConsole();
    expect(screen.getByText(/bob secret prompt/)).toBeInTheDocument();
    expect(screen.queryByText(/alice secret prompt/)).not.toBeInTheDocument();
  });

  it('purges the legacy shared queue key', () => {
    localStorage.setItem(QUEUE_STORAGE_KEY, '[]');
    renderConsole();
    expect(localStorage.getItem(QUEUE_STORAGE_KEY)).toBeNull();
  });
});

describe('world entity generation', () => {
  async function rollPerson() {
    renderConsole({ initialUniverse: 'uni1' });
    // wait until wiki access has been confirmed
    await waitFor(() => expect(m.trpc.sandbox.myPromotableUniverses.query).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^person$/i }));
    typePrompt('A weary lighthouse keeper');
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole('button', { name: /generate person/i }));
  }

  beforeEach(() => {
    m.trpc.entities.generateProfile.mutate.mockResolvedValue({ description: 'desc', metadata: {} });
    m.trpc.entities.create.mutate.mockResolvedValue({ id: 'ent1' });
  });

  it('warns and still creates the entity (no image) when the portrait fails', async () => {
    m.trpc.image.generate.mutate.mockRejectedValue(new Error('img down'));
    await rollPerson();
    await waitFor(() => expect(m.trpc.entities.create.mutate).toHaveBeenCalled());
    expect(m.trpc.entities.create.mutate.mock.calls[0][0]).toMatchObject({
      imageUrl: null,
      universeAddress: 'uni1',
    });
    expect(m.toast.warning).toHaveBeenCalledWith(expect.stringMatching(/without an image/i));
  });

  it('a failed roll gets a Retry that replays the same prompt into the same wiki', async () => {
    m.trpc.entities.generateProfile.mutate.mockRejectedValueOnce(new Error('gemini down'));
    m.trpc.image.generate.mutate.mockResolvedValue({ imageUrls: ['https://media.loar.fun/p.png'] });
    await rollPerson();
    const retry = await screen.findByRole('button', { name: /^retry$/i });
    fireEvent.click(retry);
    await waitFor(() => expect(m.trpc.entities.create.mutate).toHaveBeenCalledTimes(1));
    const second = m.trpc.entities.generateProfile.mutate.mock.calls[1][0];
    expect(second).toMatchObject({ kind: 'person', hint: 'A weary lighthouse keeper' });
    expect(m.trpc.entities.create.mutate.mock.calls[0][0].universeAddress).toBe('uni1');
    // the failed card is replaced by the retry, not duplicated
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^retry$/i })).not.toBeInTheDocument()
    );
  });
});

describe('3D image source', () => {
  it('Image → 3D stays disabled until an explicit source image exists', () => {
    renderConsole();
    fireEvent.click(screen.getAllByRole('button', { name: /^3d$/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /image → 3d/i }));
    const convert = screen.getByRole('button', { name: /convert image → 3d/i });
    expect(convert).toBeDisabled();
    expect(within(document.body).getByText(/add the source image/i)).toBeInTheDocument();
  });
});
