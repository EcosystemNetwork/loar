/**
 * Google Cloud / ERC-8004 live demo — runs the real BigQuery ranking against
 * Ethereum mainnet. Needs GCP creds (GCP_PROJECT_ID + a service account with
 * the BigQuery Job User role). If unconfigured, prints what's needed and exits
 * with code 3 (for the auto-poller).
 *
 * Run:  cd apps/server && npx tsx scripts/bigquery-demo.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  isBigQueryConfigured,
  rankAgents,
  getAgentReputation,
  ERC8004,
} from '../src/lib/bigquery-erc8004';

async function main() {
  if (!isBigQueryConfigured()) {
    console.log('⚠️  BigQuery not configured. To run the live ERC-8004 ranking:');
    console.log('    1. Set GCP_PROJECT_ID in .env');
    console.log('    2. Grant your service account the "BigQuery Job User" role,');
    console.log('       or set GCP_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS');
    console.log('    3. Re-run: npx tsx scripts/bigquery-demo.ts');
    process.exit(3);
  }

  console.log('ERC-8004 reputation via BigQuery (Ethereum mainnet)');
  console.log(`  Identity:   ${ERC8004.identity}`);
  console.log(`  Reputation: ${ERC8004.reputation}\n`);

  console.log('Querying top agents by on-chain feedback…');
  const ranked = await rankAgents(10);
  if (!ranked.length) {
    console.log('  (no NewFeedback events found in range)');
  } else {
    ranked.forEach((a, i) => {
      console.log(
        `  ${i + 1}. agent #${a.agentIdDecimal}  feedback=${a.feedbackCount}  score=${a.reputationScore}  registered=${a.registeredAt ?? '—'}`
      );
    });
    const top = ranked[0];
    console.log(`\nReputation lookup for top agent (#${top.agentIdDecimal}):`);
    const rep = await getAgentReputation(top.agentId);
    console.log(`  ${JSON.stringify(rep)}`);
  }
  console.log('\n✅ Live BigQuery query succeeded.');
  process.exit(0);
}
main().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
