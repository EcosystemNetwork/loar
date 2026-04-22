#!/usr/bin/env node
/**
 * One-time Circle DCW bootstrap.
 *
 * Requires CIRCLE_API_KEY in process.env (pulled from Railway via `railway run`).
 * Generates a fresh entity secret, registers it with Circle (including a recovery
 * file saved to ./.circle-recovery/), creates a wallet set, and prints two lines
 * formatted for the wrapper script to pick up:
 *
 *   ENTITY_SECRET=<hex>
 *   WALLET_SET_ID=<uuid>
 *
 * If either already exists (idempotency: API key has an entity already registered,
 * or a wallet set named "loar-users" exists), it reuses them.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets';

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error('CIRCLE_API_KEY missing from env');
  process.exit(1);
}

// Recovery lives outside the repo so we can't accidentally commit it.
const recoveryDir = path.resolve(
  process.env.HOME || '/tmp',
  '.loar-circle-recovery'
);
fs.mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });

async function registerEntity() {
  // 32-byte hex, per Circle's entity-secret spec.
  const entitySecret = crypto.randomBytes(32).toString('hex');

  try {
    await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: recoveryDir,
    });
    return { entitySecret, registered: true };
  } catch (err) {
    // Circle responds 400 "Entity already registered" when the key already has one.
    const msg = err?.response?.data?.message ?? err?.message ?? String(err);
    if (/already/i.test(msg)) {
      console.error(
        '[bootstrap] Entity already registered for this API key.\n' +
          '            Can not derive the existing secret — recover from your password\n' +
          '            manager or the .circle-recovery file from the original setup.\n' +
          '            Skipping registration; wallet-set creation will still run IF\n' +
          '            CIRCLE_ENTITY_SECRET is already in env.'
      );
      if (!process.env.CIRCLE_ENTITY_SECRET) {
        console.error('[bootstrap] CIRCLE_ENTITY_SECRET not in env either — aborting.');
        process.exit(2);
      }
      return { entitySecret: process.env.CIRCLE_ENTITY_SECRET, registered: false };
    }
    throw err;
  }
}

async function ensureWalletSet(entitySecret) {
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  // Look for an existing "loar-users" wallet set first.
  const list = await client.listWalletSets({ pageSize: 50 });
  const existing = list.data?.walletSets?.find((w) => w.name === 'loar-users');
  if (existing) {
    console.error(`[bootstrap] reusing existing walletSet "${existing.name}" (${existing.id})`);
    return existing.id;
  }

  const created = await client.createWalletSet({ name: 'loar-users' });
  const id = created.data?.walletSet?.id;
  if (!id) throw new Error('createWalletSet returned no id');
  console.error(`[bootstrap] created walletSet "loar-users" (${id})`);
  return id;
}

const { entitySecret, registered } = await registerEntity();
if (registered) {
  console.error(
    `[bootstrap] entity secret registered. Recovery file: ${recoveryDir}\n` +
      `            BACK THIS UP NOW — move the file to a password manager or encrypted drive.\n` +
      `            Without it you cannot recover access if Railway loses the env var.`
  );
}

const walletSetId = await ensureWalletSet(entitySecret);

// Machine-parsable lines for the wrapper. stderr has human-readable info.
process.stdout.write(`ENTITY_SECRET=${entitySecret}\n`);
process.stdout.write(`WALLET_SET_ID=${walletSetId}\n`);
