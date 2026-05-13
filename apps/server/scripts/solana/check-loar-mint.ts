/**
 * Inspect $LOAR Token-2022 mint authorities.
 *
 * Prints mint_authority + freeze_authority + supply + decimals. Exits non-zero
 * if freeze_authority is set — null is the post-bootstrap target since LOAR
 * has no use for an admin-frozen circulating supply.
 *
 * Usage:
 *   pnpm tsx apps/server/scripts/solana/check-loar-mint.ts [mint-address]
 *
 * Env:
 *   LOAR_MINT_DEVNET   (used if no arg passed)
 *   SOLANA_RPC_URL_DEVNET
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../../.env') });

async function main() {
  const mintArg = process.argv[2] ?? process.env.LOAR_MINT_DEVNET;
  if (!mintArg) {
    console.error('Pass a mint address or set LOAR_MINT_DEVNET');
    process.exit(1);
  }
  const rpcUrl =
    process.env.SOLANA_RPC_URL_DEVNET ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com';

  const conn = new Connection(rpcUrl, 'confirmed');
  const mint = await getMint(conn, new PublicKey(mintArg), 'confirmed', TOKEN_2022_PROGRAM_ID);

  const freeze = mint.freezeAuthority?.toBase58() ?? null;
  console.log(`Mint:             ${mintArg}`);
  console.log(
    `mintAuthority:    ${mint.mintAuthority?.toBase58() ?? 'null (FROZEN — mint locked)'}`
  );
  console.log(`freezeAuthority:  ${freeze ?? 'null (no freeze power — OK)'}`);
  console.log(`supply:           ${mint.supply.toString()}`);
  console.log(`decimals:         ${mint.decimals}`);
  console.log(`isInitialized:    ${mint.isInitialized}`);

  if (freeze !== null) {
    console.error('\nFREEZE AUTHORITY IS SET — run:');
    console.error(
      `  spl-token --program-id ${TOKEN_2022_PROGRAM_ID.toBase58()} authorize ${mintArg} freeze --disable --url ${rpcUrl}`
    );
    process.exit(2);
  }
  console.log('\nfreeze authority is null ✓');
}

main().catch((err) => {
  console.error('check failed:', err);
  process.exit(1);
});
