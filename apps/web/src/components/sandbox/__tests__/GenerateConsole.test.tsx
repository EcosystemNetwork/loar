import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: any) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/utils/trpc', () => ({
  trpcClient: new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => ({ query: vi.fn(), mutate: vi.fn() }) }) }
  ),
}));
vi.mock('@/lib/wallet-auth', () => ({
  useWalletAuth: () => ({ isAuthenticated: true, isAuthenticating: false, address: '0xabc' }),
}));
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ generationEnabled: true }),
}));
vi.mock('@/components/wallet-connect-button', () => ({ WalletConnectButton: () => null }));
vi.mock('@/components/ModelSelector', () => ({
  ModelSelector: () => <div>image-model-selector</div>,
}));
vi.mock('@/components/editing/VoiceModifyPanel', () => ({ VoiceModifyPanel: () => null }));

import { GenerateConsole } from '../GenerateConsole';

function renderConsole() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GenerateConsole variant="console" enableWorldKinds />
    </QueryClientProvider>
  );
}
const tab = (name: string) => screen.getAllByRole('button', { name })[0];
const promptBox = () => screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;

describe('GenerateConsole workspaces', () => {
  it('gives image and video their own actions instead of a shared form', () => {
    renderConsole();
    expect(screen.getByRole('button', { name: /generate image/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate video/i })).toBeNull();

    fireEvent.click(tab('Video'));
    expect(screen.getByRole('button', { name: /generate video/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate image/i })).toBeNull();
    expect(screen.getByText('Video controls')).toBeTruthy();
  });

  it('keeps a separate prompt per type', () => {
    renderConsole();
    fireEvent.change(promptBox(), { target: { value: 'a samurai' } });

    fireEvent.click(tab('Video'));
    expect(promptBox().value).toBe('');
    fireEvent.change(promptBox(), { target: { value: 'slow dolly in' } });

    fireEvent.click(tab('Person'));
    expect(promptBox().value).toBe('');

    fireEvent.click(tab('Image'));
    expect(promptBox().value).toBe('a samurai');
    fireEvent.click(tab('Video'));
    expect(promptBox().value).toBe('slow dolly in');
  });
});
