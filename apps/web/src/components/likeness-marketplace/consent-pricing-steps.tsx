/**
 * Shared consent + pricing step components.
 *
 * Used by:
 *   - ListVoiceForSaleDialog (voice — modalities pinned to ['full'])
 *   - /create/likeness page (likeness — modalities user-selected)
 *
 * Each step is presentational; container components own the mutation that
 * eventually calls submitConsent + createListing.
 */

import { parseEther } from 'viem';
import { ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  LIKENESS_MODALITIES,
  LIKENESS_USE_CASES,
  LIKENESS_USE_CASE_LABELS,
  LIKENESS_PROHIBITIONS,
  LIKENESS_PROHIBITION_LABELS,
  LIKENESS_ATTESTATION_TEXT_V1,
  type LikenessModality,
  type LikenessUseCase,
  type LikenessProhibition,
} from '@/hooks/useEntities';

/** Returns parsed wei, or `-1n` if the input is not a valid decimal ETH string. */
export function safeParseEther(input: string): bigint {
  if (!input.trim()) return 0n;
  try {
    return parseEther(input.trim() as `${number}`);
  } catch {
    return -1n;
  }
}

export interface ConsentState {
  modalities: Set<LikenessModality>;
  allowedUseCases: Set<LikenessUseCase>;
  prohibitions: Set<LikenessProhibition>;
  permitSale: boolean;
  permitLease: boolean;
  permitLicense: boolean;
  realPerson: boolean;
  attestationChecked: boolean;
}

export function emptyConsentState(opts?: {
  defaultModalities?: LikenessModality[];
  defaultUseCases?: LikenessUseCase[];
}): ConsentState {
  return {
    modalities: new Set(opts?.defaultModalities ?? ['full']),
    allowedUseCases: new Set(
      opts?.defaultUseCases ?? ['narrative_film', 'audiobook', 'gaming', 'documentary']
    ),
    prohibitions: new Set([...LIKENESS_PROHIBITIONS]),
    permitSale: false,
    permitLease: true,
    permitLicense: true,
    realPerson: true,
    attestationChecked: false,
  };
}

export function consentStateReady(state: ConsentState, opts?: { requireModalities?: boolean }) {
  if (opts?.requireModalities && state.modalities.size === 0) return false;
  return (
    state.allowedUseCases.size > 0 &&
    (state.permitSale || state.permitLease || state.permitLicense) &&
    state.attestationChecked
  );
}

interface ConsentStepProps {
  state: ConsentState;
  onChange: (next: ConsentState) => void;
  /** Show the modality selector. Voice listings pin to ['full']; likeness lets users pick. */
  showModalities?: boolean;
}

function toggleInSet<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val);
  else next.add(val);
  return next;
}

export function ConsentStep({ state, onChange, showModalities = false }: ConsentStepProps) {
  return (
    <div className="p-5 space-y-6">
      <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
        <ShieldCheck className="size-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold mb-1">Consent attestation</p>
          <p className="text-muted-foreground text-xs">
            Confirm rights to commercialize this likeness and choose the specific terms buyers can
            purchase under. Phase 1 uses a click-through attestation; KYC + liveness verification
            will follow in a later release.
          </p>
        </div>
      </div>

      {/* Real person */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Subject</Label>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={state.realPerson ? 'default' : 'outline'}
            onClick={() => onChange({ ...state, realPerson: true })}
          >
            My own likeness
          </Button>
          <Button
            size="sm"
            variant={!state.realPerson ? 'default' : 'outline'}
            onClick={() => onChange({ ...state, realPerson: false })}
          >
            AI persona / character
          </Button>
        </div>
      </div>

      {/* Modalities (likeness only) */}
      {showModalities && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Modalities you are licensing</Label>
            <p className="text-xs text-muted-foreground">
              Each modality must be backed by at least one reference asset you uploaded.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {LIKENESS_MODALITIES.map((m) => {
                const on = state.modalities.has(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      onChange({ ...state, modalities: toggleInSet(state.modalities, m) })
                    }
                    className={`px-2.5 py-1 rounded-full text-xs border capitalize ${
                      on
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border hover:bg-muted'
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Deal types */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Deal types you'll allow</Label>
        <div className="space-y-2">
          <DealTypeCheckbox
            checked={state.permitSale}
            onChange={(v) => onChange({ ...state, permitSale: v })}
            label="Sale"
            sub="Permanent transfer of usage rights. Buyer pays once and keeps perpetual access."
          />
          <DealTypeCheckbox
            checked={state.permitLease}
            onChange={(v) => onChange({ ...state, permitLease: v })}
            label="Lease"
            sub="Time-bounded rental. Buyer pays per day; access auto-expires."
          />
          <DealTypeCheckbox
            checked={state.permitLicense}
            onChange={(v) => onChange({ ...state, permitLicense: v })}
            label="License"
            sub="Usage rights for a fixed term with ongoing royalty on revenue."
          />
        </div>
      </div>

      <Separator />

      {/* Use cases */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Authorized use cases</Label>
        <p className="text-xs text-muted-foreground">
          Buyers can only use this likeness in projects matching one of these categories.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {LIKENESS_USE_CASES.map((uc) => {
            const on = state.allowedUseCases.has(uc);
            return (
              <button
                key={uc}
                type="button"
                onClick={() =>
                  onChange({ ...state, allowedUseCases: toggleInSet(state.allowedUseCases, uc) })
                }
                className={`px-2.5 py-1 rounded-full text-xs border ${
                  on
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted'
                }`}
              >
                {LIKENESS_USE_CASE_LABELS[uc]}
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Prohibitions */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Hard prohibitions</Label>
        <p className="text-xs text-muted-foreground">
          These uses are never authorized — buyers cannot opt out of them.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {LIKENESS_PROHIBITIONS.map((p) => {
            const on = state.prohibitions.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  onChange({ ...state, prohibitions: toggleInSet(state.prohibitions, p) })
                }
                className={`px-2.5 py-1 rounded-full text-xs border ${
                  on
                    ? 'bg-destructive/10 text-destructive border-destructive/30'
                    : 'bg-background border-border'
                }`}
              >
                {on ? '✓ ' : ''}
                {LIKENESS_PROHIBITION_LABELS[p]}
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Attestation */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Attestation</Label>
        <div className="text-xs text-muted-foreground p-3 bg-muted rounded-lg max-h-32 overflow-y-auto leading-relaxed">
          {LIKENESS_ATTESTATION_TEXT_V1}
        </div>
        <label className="flex items-start gap-2 cursor-pointer">
          <Checkbox
            checked={state.attestationChecked}
            onCheckedChange={(c) => onChange({ ...state, attestationChecked: c === true })}
          />
          <span className="text-sm">
            I have read and agree to the above attestation. I am signing as the rights holder of
            this likeness.
          </span>
        </label>
      </div>
    </div>
  );
}

function DealTypeCheckbox({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </label>
  );
}

// ── Pricing step ─────────────────────────────────────────────────────────

export interface SplitRecipient {
  recipient: string;
  /** Whole-percent display unit. Converted to bps (× 100) when submitting. */
  percent: string;
}

export interface PricingState {
  title: string;
  description: string;
  buyPriceEth: string;
  leasePerDayEth: string;
  licenseFeeEth: string;
  licenseRoyaltyBps: string;
  maxDurationDays: string;
  /** Optional multi-recipient revenue splits. Empty array = single-creator payout. */
  splitRecipients: SplitRecipient[];
}

export function emptyPricingState(opts?: { title?: string; description?: string }): PricingState {
  return {
    title: opts?.title ?? '',
    description: opts?.description ?? '',
    buyPriceEth: '',
    leasePerDayEth: '',
    licenseFeeEth: '',
    licenseRoyaltyBps: '500',
    maxDurationDays: '30',
    splitRecipients: [],
  };
}

/** Sum of split percent fields; -1 if any entry is non-numeric. */
export function splitsTotalPercent(splits: SplitRecipient[]): number {
  let sum = 0;
  for (const s of splits) {
    const n = Number(s.percent);
    if (!Number.isFinite(n) || n < 0) return -1;
    sum += n;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Convert UI splits to the on-chain bps shape. Returns null when no splits
 * are configured (the listing will use direct-creator payment + platform fee).
 * Throws if validation fails.
 */
export function splitsToBpsPayload(
  splits: SplitRecipient[]
): Array<{ recipient: string; bps: number }> | null {
  const cleaned = splits.filter(
    (s) => s.recipient.trim().length > 0 || s.percent.trim().length > 0
  );
  if (cleaned.length === 0) return null;
  if (cleaned.length > 10) throw new Error('At most 10 recipients allowed');
  const payload: Array<{ recipient: string; bps: number }> = [];
  for (const s of cleaned) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(s.recipient.trim())) {
      throw new Error(`Invalid recipient address: ${s.recipient}`);
    }
    const pct = Number(s.percent);
    if (!Number.isFinite(pct) || pct <= 0) {
      throw new Error(`Each recipient needs a positive percent`);
    }
    const bps = Math.round(pct * 100);
    payload.push({ recipient: s.recipient.trim().toLowerCase(), bps });
  }
  const totalBps = payload.reduce((s, r) => s + r.bps, 0);
  if (totalBps !== 10000) {
    throw new Error(`Splits must sum to exactly 100% (got ${(totalBps / 100).toFixed(2)}%)`);
  }
  return payload;
}

export function pricingStateReady(
  pricing: PricingState,
  consent: Pick<ConsentState, 'permitSale' | 'permitLease' | 'permitLicense'>
) {
  if (consent.permitSale && safeParseEther(pricing.buyPriceEth) <= 0n) return false;
  if (consent.permitLease && safeParseEther(pricing.leasePerDayEth) <= 0n) return false;
  if (consent.permitLicense && safeParseEther(pricing.licenseFeeEth) <= 0n) return false;
  if (!consent.permitSale && !consent.permitLease && !consent.permitLicense) return false;
  if (pricing.title.trim().length === 0) return false;
  // If splits are partially filled, require them to be valid.
  const cleaned = pricing.splitRecipients.filter(
    (s) => s.recipient.trim().length > 0 || s.percent.trim().length > 0
  );
  if (cleaned.length > 0) {
    try {
      splitsToBpsPayload(pricing.splitRecipients);
    } catch {
      return false;
    }
  }
  return true;
}

interface PricingStepProps {
  state: PricingState;
  onChange: (next: PricingState) => void;
  permitSale: boolean;
  permitLease: boolean;
  permitLicense: boolean;
}

export function PricingStep({
  state,
  onChange,
  permitSale,
  permitLease,
  permitLicense,
}: PricingStepProps) {
  function patch(k: keyof PricingState, v: string) {
    onChange({ ...state, [k]: v });
  }

  return (
    <div className="p-5 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="lm-title" className="text-sm font-semibold">
          Listing title
        </Label>
        <Input
          id="lm-title"
          value={state.title}
          onChange={(e) => patch('title', e.target.value)}
          maxLength={160}
          placeholder="Listing title"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="lm-desc" className="text-sm font-semibold">
          Description
        </Label>
        <Textarea
          id="lm-desc"
          value={state.description}
          onChange={(e) => patch('description', e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Range, look, what kinds of projects this suits…"
        />
      </div>

      <Separator />

      {permitSale && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">
              Sale price{' '}
              <Badge variant="secondary" className="ml-1 text-[10px]">
                BUY
              </Badge>
            </Label>
            <span className="text-xs text-muted-foreground">Permanent</span>
          </div>
          <EthInput
            value={state.buyPriceEth}
            onChange={(v) => patch('buyPriceEth', v)}
            placeholder="0.5"
          />
        </div>
      )}

      {permitLease && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">
              Lease price / day{' '}
              <Badge variant="secondary" className="ml-1 text-[10px]">
                LEASE
              </Badge>
            </Label>
            <span className="text-xs text-muted-foreground">Auto-expires</span>
          </div>
          <EthInput
            value={state.leasePerDayEth}
            onChange={(v) => patch('leasePerDayEth', v)}
            placeholder="0.01"
          />
        </div>
      )}

      {permitLicense && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">
              License fee{' '}
              <Badge variant="secondary" className="ml-1 text-[10px]">
                LICENSE
              </Badge>
            </Label>
            <span className="text-xs text-muted-foreground">+ royalty</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EthInput
              value={state.licenseFeeEth}
              onChange={(v) => patch('licenseFeeEth', v)}
              placeholder="0.05"
            />
            <div className="relative">
              <Input
                type="number"
                value={state.licenseRoyaltyBps}
                onChange={(e) => patch('licenseRoyaltyBps', e.target.value)}
                min={0}
                max={5000}
                placeholder="500"
                className="pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                bps
              </span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Royalty is taken from revenue on works that use this likeness. 500 bps = 5%, max 5000 =
            50%.
          </p>
        </div>
      )}

      <Separator />

      <div className="space-y-2">
        <Label htmlFor="lm-duration" className="text-sm font-semibold">
          Max lease / license duration (days)
        </Label>
        <Input
          id="lm-duration"
          type="number"
          min={1}
          max={365}
          value={state.maxDurationDays}
          onChange={(e) => patch('maxDurationDays', e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Capped at 365 days per the on-chain ContentLicensing contract.
        </p>
      </div>

      <Separator />

      <SplitsField
        splits={state.splitRecipients}
        onChange={(next) => onChange({ ...state, splitRecipients: next })}
      />
    </div>
  );
}

interface SplitsFieldProps {
  splits: SplitRecipient[];
  onChange: (next: SplitRecipient[]) => void;
}

function SplitsField({ splits, onChange }: SplitsFieldProps) {
  const total = splitsTotalPercent(splits);
  const cleaned = splits.filter((s) => s.recipient.trim() || s.percent.trim());
  const showValidator = cleaned.length > 0;
  const isValid = (() => {
    if (cleaned.length === 0) return true; // optional; empty is fine
    try {
      splitsToBpsPayload(splits);
      return true;
    } catch {
      return false;
    }
  })();

  function update(i: number, patch: Partial<SplitRecipient>) {
    const next = [...splits];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }

  function add() {
    if (splits.length >= 10) return;
    onChange([...splits, { recipient: '', percent: '' }]);
  }

  function remove(i: number) {
    onChange(splits.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">
          Revenue splits{' '}
          <Badge variant="outline" className="ml-1 text-[10px]">
            Optional
          </Badge>
        </Label>
        {showValidator && (
          <span
            className={`text-xs font-medium ${
              isValid && total === 100 ? 'text-green-600' : 'text-destructive'
            }`}
          >
            {total < 0 ? 'Invalid' : `${total.toFixed(2)}% / 100%`}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Route payments to multiple recipients (collaborators, co-creators, charity). Percentages
        must sum to exactly 100%. If empty, all revenue routes to your wallet minus the 5% platform
        fee.
      </p>

      {splits.length > 0 && (
        <div className="space-y-1.5">
          {splits.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={s.recipient}
                onChange={(e) => update(i, { recipient: e.target.value })}
                placeholder="0x… recipient address"
                className="flex-1 font-mono text-xs"
              />
              <div className="relative w-24">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={s.percent}
                  onChange={(e) => update(i, { percent: e.target.value })}
                  placeholder="25"
                  className="pr-7"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => remove(i)}
                title="Remove split"
                className="shrink-0"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={add}
        disabled={splits.length >= 10}
        className="w-full"
      >
        + Add recipient {splits.length > 0 && `(${splits.length}/10)`}
      </Button>
    </div>
  );
}

function EthInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-12"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        ETH
      </span>
    </div>
  );
}
