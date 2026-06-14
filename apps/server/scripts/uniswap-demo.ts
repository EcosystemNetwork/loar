/**
 * Uniswap live demo — a real Sepolia swap via the Trading API + Circle DCW.
 * Needs Circle creds (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID)
 * + UNISWAP_API_KEY, and a Sepolia-funded Circle wallet. Prints the wallet to
 * fund and exits 3 if not ready (for the auto-poller).
 *
 * Run:  cd apps/server && npx tsx scripts/uniswap-demo.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { formatEther } from 'viem';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { isCircleConfigured, getOrCreateWalletForChain } from '../src/lib/circle-wallets';
import {
  isUniswapTradingConfigured,
  executeSwap,
  NATIVE_TOKEN,
} from '../src/lib/uniswap-trading-api';
import { getChainClient } from '../src/lib/chain-client';
import { LoarToken } from '@loar/abis/addresses';

const SEPOLIA = 11155111;
const DEMO_UID = 'loar-uniswap-demo';

async function main() {
  if (!isUniswapTradingConfigured()) {
    console.log('⚠️  UNISWAP_API_KEY missing.');
    process.exit(3);
  }
  if (!isCircleConfigured()) {
    console.log('⚠️  Circle not configured. Set CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET +');
    console.log('    CIRCLE_WALLET_SET_ID (https://console.circle.com), then re-run.');
    process.exit(3);
  }

  const wallet = await getOrCreateWalletForChain(DEMO_UID, SEPOLIA);
  console.log(`Demo Circle wallet (Sepolia): ${wallet.address}`);

  const bal = await getChainClient(SEPOLIA).getBalance({
    address: wallet.address as `0x${string}`,
  });
  console.log(`Sepolia ETH balance: ${formatEther(bal)}`);
  if (bal < 2_000_000_000_000_000n) {
    // < 0.002 ETH
    console.log('⚠️  Fund this wallet with Sepolia ETH (a public faucet), then re-run:');
    console.log(`    ${wallet.address}`);
    process.exit(3);
  }

  const loar = (LoarToken as Record<string, string>)[String(SEPOLIA)];
  console.log(`\nSwapping 0.001 ETH → $LOAR (${loar}) via Uniswap Trading API…`);
  const result = await executeSwap({
    wallet: { walletId: wallet.walletId, address: wallet.address },
    tokenIn: NATIVE_TOKEN,
    tokenOut: loar,
    amount: '1000000000000000', // 0.001 ETH
    chainId: SEPOLIA,
  });
  console.log(`  state: ${result.state}`);
  console.log(`  tx:    https://sepolia.etherscan.io/tx/${result.txHash}`);
  console.log(`\n✅ Done. Submission tx hash: ${result.txHash}`);
  process.exit(0);
}
main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
