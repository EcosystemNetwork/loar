/**
 * Minimal Token Launch — pump.fun-style quick-launch (name + symbol + image).
 *
 * EVM: wraps the UniverseManager createUniverseWithToken() call with sensible
 * defaults so creators who don't need the full cinematic worldbuilding wizard
 * can launch a token in one transaction.
 *
 * Solana: when the build is wired for Solana (`VITE_SOLANA_CLUSTER`), the chain
 * picker offers it too. There is no wallet-adapter / mint-fee step — the server
 * signs the Anchor `initialize_universe` ix with the caller's Circle-managed
 * wallet and creates a `monetized` universe PDA (the SPL token mint is a
 * follow-up step on the universe page).
 *
 * Layout: a numbered form on the left, a live card preview + launch summary on
 * the right (sticky on desktop). For the full experience (characters,
 * episodes, lore), `/cinematicUniverseCreate` is linked from the summary.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, type ReactNode } from 'react';
import { useChainId } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useUniverseManager, useDefaultDeploymentConfig } from '@/hooks/useUniverseManager';
import { useSolanaUniverseInit } from '@/hooks/useSolanaUniverseInit';
import { ChainSelector } from '@/components/ChainSelector';
import { SUPPORTED_CHAINS, DEFAULT_CHAIN_SELECTION, type ChainSelection } from '@/configs/chains';
import { DirectUpload } from '@/components/DirectUpload';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Price } from '@/components/Price';
import { DevBuyStep } from '@/components/tokens/DevBuyStep';
import { LaunchpadNav } from '@/components/tokens/launchpad/LaunchpadNav';
import { GraduationBar, StagePill, TokenAvatar } from '@/components/tokens/launchpad/primitives';
import { encodeTokenMetadata, normalizeSocial, MAX_METADATA_LENGTH } from '@/lib/token-metadata';
import { cn } from '@/lib/utils';
import {
  Rocket,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Globe,
  Send,
  Lock,
  Sparkles,
} from 'lucide-react';

export const Route = createFileRoute('/tokens/launch')({
  component: LaunchTokenPage,
});

const SYMBOL_REGEX = /^[A-Z0-9]{3,10}$/;
const MAX_INITIAL_BUY_ETH = 10;
const INITIAL_BUY_PRESETS = ['0.01', '0.05', '0.1', '0.5'];

const SUPPLY_SPLIT = [
  { label: 'Bonding curve', pct: 80, className: 'bg-primary' },
  { label: 'Creator (vested)', pct: 10, className: 'bg-amber-500' },
  { label: 'Treasury', pct: 5, className: 'bg-secondary' },
  { label: 'Community', pct: 5, className: 'bg-emerald-500' },
];

function LaunchTokenPage() {
  const navigate = useNavigate();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { createUniverseWithToken, mintFee, mintFeeLoading, isPending, error } =
    useUniverseManager();
  const defaults = useDefaultDeploymentConfig();
  const solanaInit = useSolanaUniverseInit();

  // Chain picker — EVM chains always, plus the active Solana cluster when the
  // build sets `VITE_SOLANA_CLUSTER`. Seed from the wallet's current chain so
  // the dropdown matches reality on first render.
  const [chainSelection, setChainSelection] = useState<ChainSelection>(() => {
    const match = SUPPORTED_CHAINS.find(
      (c) => c.selection.kind === 'evm' && c.selection.chainId === chainId
    );
    return match?.selection ?? DEFAULT_CHAIN_SELECTION;
  });
  const isSolana = chainSelection.kind === 'solana';

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [imageURL, setImageURL] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [initialBuy, setInitialBuy] = useState('');
  const [launchedAt, setLaunchedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [localError, setLocalError] = useState<string | null>(null);

  const initialBuyNum = initialBuy.trim() === '' ? 0 : Number(initialBuy);

  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!name.trim()) issues.push('Name required');
    else if (name.length > 50) issues.push('Name too long (max 50)');
    // Solana init doesn't mint the SPL token here, so the ticker is optional on
    // that path (it's set when the token is minted from the universe page).
    const trimmedSymbol = symbol.trim().toUpperCase();
    if (!trimmedSymbol) {
      if (!isSolana) issues.push('Symbol required');
    } else if (!SYMBOL_REGEX.test(trimmedSymbol)) {
      issues.push('Symbol must be 3–10 uppercase letters or numbers');
    }
    if (!imageURL) issues.push('Image required');
    if (description.length > 280) issues.push('Description too long (max 280)');
    // The Solana initialize ix seeds the PDA from a hash of name + description,
    // so the server requires a non-empty description on that path.
    if (isSolana && !description.trim()) issues.push('Description required on Solana');
    // Social links + initial buy only apply to the EVM token launch.
    if (!isSolana) {
      if (website.trim() && !normalizeSocial('website', website))
        issues.push('Website must be a valid https link');
      if (twitter.trim() && !normalizeSocial('twitter', twitter))
        issues.push('X / Twitter must be a handle or an x.com link');
      if (telegram.trim() && !normalizeSocial('telegram', telegram))
        issues.push('Telegram must be a handle or a t.me link');
      if (initialBuy.trim() !== '') {
        if (!Number.isFinite(initialBuyNum) || initialBuyNum <= 0)
          issues.push('Initial buy must be a positive ETH amount');
        else if (initialBuyNum > MAX_INITIAL_BUY_ETH)
          issues.push(`Initial buy is capped at ${MAX_INITIAL_BUY_ETH} ETH`);
      }
      if (
        encodeTokenMetadata({ description, socials: { website, twitter, telegram } }).length >
        MAX_METADATA_LENGTH
      )
        issues.push('Description and links are too long to store on-chain');
    }
    return issues;
  }, [
    name,
    symbol,
    imageURL,
    description,
    isSolana,
    website,
    twitter,
    telegram,
    initialBuy,
    initialBuyNum,
  ]);

  const defaultsReady =
    defaults.defaultHook && defaults.defaultLocker && defaults.defaultPairedToken;

  const canSubmit =
    isConnected &&
    validation.length === 0 &&
    status !== 'submitting' &&
    (isSolana ? !solanaInit.isPending : defaultsReady && !isPending);

  const handleLaunch = async () => {
    if (!address) return;

    const trimmedSymbol = symbol.trim().toUpperCase();
    const trimmedName = name.trim();

    // ── Solana path ──────────────────────────────────────────────────────
    // No wallet chain, no mint fee, no token step — the server signs the
    // Anchor ix with the caller's Circle-managed wallet and writes the
    // Firestore mirror itself. The SPL mint is a follow-up on the universe.
    if (isSolana) {
      setLocalError(null);
      setStatus('submitting');
      try {
        const res = await solanaInit.initializeUniverse({
          name: trimmedName,
          imageUrl: imageURL,
          description: description.trim(),
          universeType: 'monetized',
        });
        setStatus('success');
        setTimeout(() => {
          navigate({ to: '/universe/$id', params: { id: res.universePda } });
        }, 2500);
      } catch (err: any) {
        setLocalError(err?.message ?? 'Launch failed');
        setStatus('error');
      }
      return;
    }

    if (!defaultsReady) return;
    setLocalError(null);
    setStatus('submitting');
    const startedAt = Math.floor(Date.now() / 1000);

    const gradTicks = defaults.graduationTicks();
    try {
      await createUniverseWithToken(
        {
          name: trimmedName,
          imageURL,
          description: description.trim(),
          nodeCreationOptions: 0,
          nodeVisibilityOptions: 0,
          initialOwner: address,
        },
        {
          tokenConfig: {
            tokenAdmin: address,
            name: trimmedName,
            symbol: trimmedSymbol,
            imageURL,
            // Description + social links, stored in the token's on-chain metadata.
            metadata: encodeTokenMetadata({ description, socials: { website, twitter, telegram } }),
            context: '',
          },
          poolConfig: {
            hook: defaults.defaultHook!,
            pairedToken: defaults.defaultPairedToken!,
            tickIfToken0IsLoar: gradTicks?.tickIfToken0IsLoar ?? defaults.defaultTickIfToken0IsLoar,
            tickSpacing: defaults.defaultTickSpacing,
            poolData: defaults.defaultPoolData,
          },
          lockerConfig: {
            locker: defaults.defaultLocker!,
            rewardAdmins: [address],
            rewardRecipients: [address],
            rewardBps: [10_000],
            tickLower: gradTicks?.tickLower ?? [-230400],
            tickUpper: gradTicks?.tickUpper ?? [230400],
            positionBps: [10_000],
            lockerData: '0x',
          },
        }
      );
      setStatus('success');
      if (initialBuyNum > 0) {
        // Hand off to the dev-buy step — it needs the indexer to see the token.
        setLaunchedAt(startedAt);
        return;
      }
      setTimeout(() => {
        navigate({ to: '/tokens' });
      }, 2500);
    } catch (err: any) {
      const msg = err?.shortMessage ?? err?.message ?? 'Launch failed';
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setStatus('idle');
        return;
      }
      setLocalError(msg);
      setStatus('error');
    }
  };

  const feeEth = mintFee !== undefined ? Number(mintFee) / 1e18 : null;
  const displaySymbol = symbol.trim().toUpperCase() || 'TICKER';
  const touched = !!(name || symbol || imageURL);
  const busy = status === 'submitting' || isPending || solanaInit.isPending;

  return (
    <div className="min-h-screen bg-background pb-bottom-nav md:pb-12">
      <LaunchpadNav />

      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Launch a token</h1>
          <p className="mt-1.5 text-muted-foreground">
            {isSolana
              ? 'Create a monetized universe on Solana — signed server-side, no gas.'
              : 'One transaction. Fixed 1B supply, sold on a bonding curve, then graduated to Uniswap v4 with liquidity locked forever.'}
          </p>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── Form ─────────────────────────────────────────────────── */}
          <form
            className="space-y-6"
            // Launch is an explicit button press — Enter in a field must not fire a tx.
            onSubmit={(e) => e.preventDefault()}
            noValidate
          >
            <FormSection step={1} title="Identity" description="What people see on the launchpad.">
              <ChainSelector value={chainSelection} onChange={setChainSelection} />

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="space-y-1.5">
                  <Label htmlFor="token-name">Name</Label>
                  <Input
                    id="token-name"
                    autoComplete="off"
                    placeholder="Sunset Protocol"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="token-symbol">
                    Ticker{' '}
                    {isSolana && (
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    )}
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="token-symbol"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="SUN"
                      value={symbol}
                      onChange={(e) =>
                        setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                      }
                      maxLength={10}
                      aria-describedby="token-symbol-hint"
                      className="pl-7 font-mono uppercase tracking-wider"
                    />
                  </div>
                  <p id="token-symbol-hint" className="text-xs text-muted-foreground">
                    3–10 letters or numbers
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Image</Label>
                {imageURL ? (
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/40 p-3">
                    <img
                      src={imageURL}
                      alt="Token image preview"
                      decoding="async"
                      className="h-20 w-20 rounded-xl object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                        Uploaded
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {imageURL}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setImageURL('')}
                    >
                      Replace
                    </Button>
                  </div>
                ) : (
                  <DirectUpload
                    label="Drop a square image, or click to upload"
                    acceptedTypes={['image/jpeg', 'image/png', 'image/webp', 'image/gif']}
                    maxSizeMB={5}
                    onUploadComplete={(manifest, previewUrl) => {
                      // Persistent IPFS URL goes on-chain; fall back to the
                      // local blob preview only if the manifest is empty.
                      setImageURL(manifest.uploads[0]?.url || previewUrl);
                    }}
                  />
                )}
              </div>
            </FormSection>

            <FormSection
              step={2}
              title="Story"
              description={
                isSolana
                  ? 'Required on Solana — it seeds the universe address.'
                  : 'Optional. Tell people what the universe is about.'
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor="token-desc" className="sr-only">
                  Description
                </Label>
                <Textarea
                  id="token-desc"
                  placeholder="A drowned city where memories are currency…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={280}
                  rows={3}
                />
                <p
                  className={cn(
                    'text-right text-xs tabular-nums',
                    description.length > 260
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground'
                  )}
                >
                  {description.length}/280
                </p>
              </div>
            </FormSection>

            {!isSolana && (
              <>
                <FormSection
                  step={3}
                  title="Links"
                  description="Optional. Shown on your token page."
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <IconInput
                      id="token-website"
                      label="Website"
                      icon={<Globe className="h-3.5 w-3.5" aria-hidden />}
                      placeholder="https://…"
                      type="url"
                      value={website}
                      onChange={setWebsite}
                    />
                    <IconInput
                      id="token-twitter"
                      label="X / Twitter"
                      icon={
                        <span className="text-xs font-bold" aria-hidden>
                          𝕏
                        </span>
                      }
                      placeholder="@handle"
                      value={twitter}
                      onChange={setTwitter}
                    />
                    <IconInput
                      id="token-telegram"
                      label="Telegram"
                      icon={<Send className="h-3.5 w-3.5" aria-hidden />}
                      placeholder="@group"
                      value={telegram}
                      onChange={setTelegram}
                    />
                  </div>
                </FormSection>

                <FormSection
                  step={4}
                  title="Initial buy"
                  description="Optional. Be your token's first buyer — a second wallet confirmation right after it deploys."
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative sm:w-44">
                      <Label htmlFor="token-initial-buy" className="sr-only">
                        Initial buy in ETH
                      </Label>
                      <Input
                        id="token-initial-buy"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.0"
                        value={initialBuy}
                        onChange={(e) => setInitialBuy(e.target.value.replace(/[^0-9.]/g, ''))}
                        className="pr-12 font-mono"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ETH
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 sm:flex">
                      {INITIAL_BUY_PRESETS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setInitialBuy(v)}
                          aria-pressed={initialBuy === v}
                          className={cn(
                            'h-9 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            initialBuy === v
                              ? 'border-primary/50 bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          {v}
                        </button>
                      ))}
                      {initialBuy && (
                        <button
                          type="button"
                          onClick={() => setInitialBuy('')}
                          className="h-9 rounded-md px-3 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  </div>
                </FormSection>
              </>
            )}
          </form>

          {/* ── Preview + summary ────────────────────────────────────── */}
          <aside className="space-y-4 lg:sticky lg:top-[7.5rem] lg:self-start">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              <div
                className="rounded-xl border border-border bg-card"
                aria-label="Launchpad card preview"
              >
                <div className="flex gap-3 p-4">
                  <TokenAvatar imageURL={imageURL || null} symbol={displaySymbol} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate font-semibold', !name && 'text-muted-foreground')}>
                      {name.trim() || 'Your token'}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      ${displaySymbol} · just now
                    </p>
                    <div className="mt-1.5">
                      <StagePill stage="bonding" />
                    </div>
                  </div>
                </div>
                {description.trim() && (
                  <p className="line-clamp-2 px-4 text-xs text-muted-foreground">{description}</p>
                )}
                <div className="px-4 pb-4 pt-3">
                  <GraduationBar pct={0} stage="bonding" />
                  <p className="mt-1 text-[11px] text-muted-foreground">0% to Uniswap</p>
                </div>
              </div>
            </div>

            <section className="space-y-4 rounded-xl border border-border bg-card p-4">
              {!isSolana ? (
                <div>
                  <p className="mb-2 text-sm font-semibold">Supply · 1,000,000,000</p>
                  <div className="flex h-2 overflow-hidden rounded-full" aria-hidden>
                    {SUPPLY_SPLIT.map((s) => (
                      <span key={s.label} className={s.className} style={{ width: `${s.pct}%` }} />
                    ))}
                  </div>
                  <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {SUPPLY_SPLIT.map((s) => (
                      <li key={s.label} className="flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', s.className)} aria-hidden />
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="ml-auto font-mono tabular-nums">{s.pct}%</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />
                    LP locked on-chain forever after graduation
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Creates a monetized universe PDA. Mint the SPL token from the universe page once
                  it&apos;s live.
                </p>
              )}

              {!isSolana && (feeEth !== null || mintFeeLoading) && (
                <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
                  <span className="text-muted-foreground">Launch fee</span>
                  <span className="font-mono tabular-nums">
                    {feeEth !== null ? <Price eth={feeEth} hideChain /> : 'Loading…'}
                  </span>
                </div>
              )}
              {!isSolana && initialBuyNum > 0 && validation.length === 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Initial buy</span>
                  <span className="font-mono tabular-nums">{initialBuy} ETH</span>
                </div>
              )}

              {/* Validation */}
              {validation.length > 0 && touched && (
                <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  {validation.map((msg) => (
                    <li
                      key={msg}
                      className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-200"
                    >
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden />
                      {msg}
                    </li>
                  ))}
                </ul>
              )}

              {!isSolana && !defaultsReady && (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                  This network isn&apos;t supported. Switch to Ethereum Sepolia or mainnet.
                </p>
              )}

              {/* Tx status */}
              <div aria-live="polite" className="space-y-3 empty:hidden">
                {status === 'submitting' && (
                  <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {isSolana
                      ? 'Creating your universe on Solana…'
                      : 'Confirm the transaction in your wallet…'}
                  </p>
                )}
                {status === 'success' && (
                  <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    {isSolana
                      ? 'Universe launched! Redirecting…'
                      : launchedAt
                        ? 'Token launched!'
                        : 'Token launched! Redirecting…'}
                  </p>
                )}
                {status === 'success' && launchedAt && address && (
                  <DevBuyStep
                    deployer={address}
                    symbol={symbol.trim().toUpperCase()}
                    ethAmount={initialBuy.trim()}
                    sinceSec={launchedAt}
                  />
                )}
                {status === 'error' && (localError || error || solanaInit.error) && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300"
                  >
                    {localError ??
                      (error as any)?.message ??
                      solanaInit.error?.message ??
                      'Launch failed'}
                  </p>
                )}
              </div>

              {launchedAt ? null : !isConnected ? (
                <Button className="h-12 w-full text-base font-bold" disabled>
                  Connect a wallet to launch
                </Button>
              ) : (
                <Button
                  className="h-12 w-full text-base font-bold transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
                  onClick={handleLaunch}
                  disabled={!canSubmit}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
                      Launching…
                    </>
                  ) : (
                    <>
                      <Rocket className="mr-2 h-5 w-5" aria-hidden />
                      {isSolana ? 'Launch universe' : `Launch $${displaySymbol}`}
                    </>
                  )}
                </Button>
              )}
            </section>

            <Link
              to="/cinematicUniverseCreate"
              className="flex items-start gap-3 rounded-xl border border-dashed border-border p-4 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
              <span>
                <span className="font-medium">Want characters, episodes and lore?</span>
                <span className="block text-xs text-muted-foreground">
                  Use the full universe wizard instead.
                </span>
              </span>
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FormSection({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="rounded-xl border border-border bg-card p-5">
      <legend className="sr-only">{title}</legend>
      <div className="mb-4 flex gap-3">
        <span
          aria-hidden
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary"
        >
          {step}
        </span>
        <div>
          <h2 className="font-semibold leading-7">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

function IconInput({
  id,
  label,
  icon,
  placeholder,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  icon: ReactNode;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        <Input
          id={id}
          type={type}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={200}
          className="pl-8"
        />
      </div>
    </div>
  );
}
