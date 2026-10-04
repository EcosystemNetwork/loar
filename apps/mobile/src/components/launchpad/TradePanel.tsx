/**
 * Buy / sell a bonding-curve token from the app.
 *
 * The server quotes the curve (`launchpad.quote` — mobile has no RPC client)
 * and returns every amount as a wei string with slippage already applied; the
 * trade itself goes through the same Circle-signed /api/tx/write path the web
 * uses. Graduated tokens trade on Uniswap and still hand off to loar.fun.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { formatWei, weiToInput } from '../../lib/launchpad-format';
import { trpc, trpcClient, type RouterOutputs } from '../../lib/trpc';
import {
  BONDING_CURVE_WRITE_ABI,
  ERC20_APPROVE_ABI,
  explorerTxUrl,
  writeContract,
} from '../../lib/tx-write';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type Side = 'buy' | 'sell';
type Quote = RouterOutputs['launchpad']['quote'];
type Phase = 'idle' | 'approving' | 'trading';

const AMOUNT_RE = /^\d{1,18}(\.\d{1,18})?$/;
const BUY_PRESETS = ['0.01', '0.05', '0.1'];

function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ])
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function TradePanel({ token, symbol }: { token: string; symbol: string }) {
  const queryClient = useQueryClient();
  const [side, setSide] = useState<Side>('buy');
  const [amount, setAmount] = useState('');
  const [debounced, setDebounced] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(amount.trim()), 350);
    return () => clearTimeout(t);
  }, [amount]);

  const valid = AMOUNT_RE.test(debounced) && Number(debounced) > 0;
  const quoteQuery = useQuery({
    ...trpc.launchpad.quote.queryOptions({ address: token, side, amount: debounced || '0' }),
    enabled: valid,
    staleTime: 10_000,
    retry: false,
  });
  const quote = quoteQuery.data as Quote | undefined;
  const busy = phase !== 'idle';
  const outSymbol = side === 'buy' ? `$${symbol}` : 'ETH';
  const balance = side === 'buy' ? quote?.ethBalance : quote?.tokenBalance;

  const submit = async () => {
    if (!AMOUNT_RE.test(amount.trim())) return;
    try {
      // Re-quote right before signing so minOut and the deadline are fresh.
      const q = (await trpcClient.launchpad.quote.query({
        address: token,
        side,
        amount: amount.trim(),
      })) as Quote;

      const ok = await confirm(
        side === 'buy' ? `Buy $${symbol}` : `Sell $${symbol}`,
        side === 'buy'
          ? `Pay ${amount.trim()} ETH for ≈ ${formatWei(q.expectedOutWei)} $${symbol}.\nYou get at least ${formatWei(q.minOutWei)} or the trade reverts.`
          : `Sell ${amount.trim()} $${symbol} for ≈ ${formatWei(q.expectedOutWei, 6)} ETH.\nYou get at least ${formatWei(q.minOutWei, 6)} ETH or the trade reverts.` +
              (q.needsApproval ? '\n\nThis needs a one-time token approval first.' : ''),
        side === 'buy' ? 'Buy' : 'Sell'
      );
      if (!ok) return;

      let hash: string;
      if (side === 'buy') {
        setPhase('trading');
        hash = await writeContract({
          address: q.curve,
          abi: BONDING_CURVE_WRITE_ABI,
          functionName: 'buy',
          args: [q.minOutWei, String(q.deadline)],
          value: q.amountWei,
          chainId: q.chainId,
        });
      } else {
        if (q.needsApproval) {
          setPhase('approving');
          await writeContract({
            address: q.token,
            abi: ERC20_APPROVE_ABI,
            functionName: 'approve',
            args: [q.curve, q.amountWei],
            chainId: q.chainId,
          });
        }
        setPhase('trading');
        // The approval can take most of the quote's deadline window to mine.
        const deadline = Math.max(q.deadline, Math.floor(Date.now() / 1000) + 300);
        hash = await writeContract({
          address: q.curve,
          abi: BONDING_CURVE_WRITE_ABI,
          functionName: 'sell',
          args: [q.amountWei, q.minOutWei, String(deadline)],
          chainId: q.chainId,
        });
      }

      setAmount('');
      void queryClient.invalidateQueries({ queryKey: trpc.launchpad.pathKey() });
      Alert.alert(side === 'buy' ? 'Bought' : 'Sold', 'Your trade is confirmed on-chain.', [
        {
          text: 'View transaction',
          onPress: () => void Linking.openURL(explorerTxUrl(q.chainId, hash)),
        },
        { text: 'Done' },
      ]);
    } catch (err) {
      Alert.alert('Trade failed', errorMessage(err));
    } finally {
      setPhase('idle');
    }
  };

  return (
    <Card>
      <View className="gap-3">
        <View className="flex-row bg-zinc-900 rounded-xl p-1">
          {(['buy', 'sell'] as const).map((s) => (
            <Pressable
              key={s}
              disabled={busy}
              onPress={() => {
                setSide(s);
                setAmount('');
              }}
              className={`flex-1 py-2 rounded-lg items-center ${side === s ? (s === 'buy' ? 'bg-primary' : 'bg-error') : ''}`}
            >
              <Text
                className={`font-semibold ${side === s ? 'text-white' : 'text-text-secondary'}`}
              >
                {s === 'buy' ? 'Buy' : 'Sell'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-text-secondary text-sm">
            {side === 'buy' ? 'Amount (ETH)' : `Amount ($${symbol})`}
          </Text>
          {balance != null && (
            <Pressable
              disabled={busy || side === 'buy'}
              onPress={() => balance && setAmount(weiToInput(balance))}
            >
              <Text className="text-text-tertiary text-xs">
                Balance: {formatWei(balance)}
                {side === 'sell' ? ' · Max' : ''}
              </Text>
            </Pressable>
          )}
        </View>
        <TextInput
          value={amount}
          onChangeText={(t) => setAmount(t.replace(',', '.'))}
          placeholder="0.0"
          placeholderTextColor="#52525b"
          keyboardType="decimal-pad"
          inputMode="decimal"
          editable={!busy}
          className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-text-primary text-lg"
        />
        {side === 'buy' && (
          <View className="flex-row gap-2">
            {BUY_PRESETS.map((p) => (
              <Button
                key={p}
                variant="secondary"
                size="sm"
                disabled={busy}
                onPress={() => setAmount(p)}
              >
                {`${p} ETH`}
              </Button>
            ))}
          </View>
        )}

        <Text className="text-text-secondary text-sm min-h-5">
          {!valid
            ? ' '
            : quoteQuery.isFetching
              ? 'Quoting…'
              : quoteQuery.error
                ? quoteQuery.error.message
                : quote
                  ? `You receive ≈ ${formatWei(quote.expectedOutWei, side === 'buy' ? 2 : 6)} ${outSymbol} (5% max slippage)`
                  : ' '}
        </Text>

        <Button
          variant={side === 'buy' ? 'primary' : 'danger'}
          fullWidth
          loading={busy}
          disabled={!valid || !quote || busy}
          onPress={() => void submit()}
        >
          {phase === 'approving'
            ? 'Approving…'
            : phase === 'trading'
              ? side === 'buy'
                ? 'Buying…'
                : 'Selling…'
              : side === 'buy'
                ? `Buy $${symbol}`
                : `Sell $${symbol}`}
        </Button>
      </View>
    </Card>
  );
}
