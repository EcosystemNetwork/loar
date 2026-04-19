#!/usr/bin/env tsx
/**
 * LOAR Testnet Smoke Harness
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs a full end-to-end journey across every testable layer:
 *
 *   server   → health, CORS, tRPC health check, nonce endpoint
 *   auth     → SIWE nonce → sign → verify → JWT
 *   universe → list, create, read-back via Firestore
 *   storage  → uploadDirect, resolve, getManifest
 *   ai       → model list, optional generation (requires FAL_KEY)
 *   chain    → RPC, contract code, optional createNode (requires SMOKE_PRIVATE_KEY)
 *   indexer  → /health, GraphQL schema, universe/node queries, optional sync check
 *
 * Usage:
 *   pnpm smoke                           # all layers, localhost defaults
 *   SERVER_URL=https://api.loar.fun pnpm smoke
 *   SMOKE_LAYER=chain pnpm smoke         # single layer
 *   pnpm smoke --json                    # CI output
 *   SMOKE_PRIVATE_KEY=0x... SMOKE_UNIVERSE_ADDRESS=0x... pnpm smoke
 *
 * Exit codes:
 *   0 — all checks passed (skipped checks do not count as failures)
 *   1 — one or more checks failed
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load root .env so smoke inherits CORS_ORIGIN, VITE_PONDER_URL, etc.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { loadConfig } from './config.ts';
import { Reporter } from './reporter.ts';
import { SMOKE_WALLETS } from './fixtures.ts';
import { runServerLayer } from './layers/server.ts';
import { runAuthLayer } from './layers/auth.ts';
import { runUniverseLayer } from './layers/universe.ts';
import { runStorageLayer } from './layers/storage.ts';
import { runGenerationLayer } from './layers/generation.ts';
import { runChainLayer } from './layers/chain.ts';
import { runIndexerLayer } from './layers/indexer.ts';
import { runAdminLayer } from './layers/admin.ts';
import { runEditingLayer } from './layers/editing.ts';

async function main() {
  const cfg = loadConfig();
  const reporter = new Reporter({ json: cfg.json, quiet: cfg.quiet });

  reporter.header(cfg.serverUrl, cfg.indexerUrl, SMOKE_WALLETS.primary.address, cfg.chainId);

  // Shared state passed between layers
  let jwt = '';
  let chainNodeId: bigint | undefined;
  let chainUniverseAddress: string | undefined;

  const only = cfg.layer?.toLowerCase();

  // ── Layer 1: server ─────────────────────────────────────────────────────────
  if (!only || only === 'server') {
    reporter.beginLayer('server', 'Health, CORS, nonce');
    const checks = await runServerLayer(cfg);
    reporter.recordLayer({ layer: 'server', title: 'Health, CORS, nonce', checks, skipped: false });
  }

  // ── Layer 2: auth ────────────────────────────────────────────────────────────
  if (!only || only === 'auth') {
    reporter.beginLayer('auth', 'SIWE: nonce → sign → verify → JWT');
    const result = await runAuthLayer(cfg);
    jwt = result.token;
    reporter.recordLayer({
      layer: 'auth',
      title: 'SIWE: nonce → sign → verify → JWT',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Layer 3: universe ────────────────────────────────────────────────────────
  if (!only || only === 'universe') {
    reporter.beginLayer('universe', 'Firestore CRUD');
    const result = await runUniverseLayer(cfg, jwt);
    reporter.recordLayer({
      layer: 'universe',
      title: 'Firestore CRUD',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Layer 4: storage ─────────────────────────────────────────────────────────
  if (!only || only === 'storage') {
    reporter.beginLayer('storage', 'Upload, resolve, manifest');
    const result = await runStorageLayer(cfg, jwt);
    reporter.recordLayer({
      layer: 'storage',
      title: 'Upload, resolve, manifest',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Layer 5: ai (generation) ─────────────────────────────────────────────────
  if (!only || only === 'ai' || only === 'generation') {
    reporter.beginLayer('ai', 'Model list + optional generation');
    const result = await runGenerationLayer(cfg, jwt);
    reporter.recordLayer({
      layer: 'ai',
      title: 'Model list + optional generation',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Layer 6: chain ───────────────────────────────────────────────────────────
  if (!only || only === 'chain') {
    reporter.beginLayer('chain', 'Sepolia RPC + contracts');
    const result = await runChainLayer(cfg);
    chainNodeId = result.nodeId;
    chainUniverseAddress = cfg.universeAddress;
    reporter.recordLayer({
      layer: 'chain',
      title: 'Sepolia RPC + contracts',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Layer 7: indexer ─────────────────────────────────────────────────────────
  if (!only || only === 'indexer') {
    reporter.beginLayer('indexer', 'Ponder GraphQL');
    const result = await runIndexerLayer(cfg, chainNodeId, chainUniverseAddress);
    reporter.recordLayer({
      layer: 'indexer',
      title: 'Ponder GraphQL',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Layer 8: admin + ops ─────────────────────────────────────────────────────
  // Metrics shape, admin auth gates, public DMCA endpoint. Only runs when the
  // auth layer produced a JWT — otherwise there's nothing to test auth against.
  if (!only || only === 'admin' || only === 'ops') {
    reporter.beginLayer('admin', 'Metrics + admin auth gates + DMCA');
    const checks = await runAdminLayer(cfg, {
      userToken: jwt,
      // Optional: an already-minted admin token from env lets the smoke verify
      // getConfig succeeds end-to-end. Without it, the smoke still verifies the
      // auth gate works (unauth → denied, user → denied).
      adminToken: process.env.SMOKE_ADMIN_TOKEN,
    });
    reporter.recordLayer({
      layer: 'admin',
      title: 'Metrics + admin auth gates + DMCA',
      checks,
      skipped: false,
    });
  }

  // ── Layer 9: editing (PRDs 1-10: edit canvas, workflows, lineage, etc.) ─────
  if (!only || only === 'editing') {
    reporter.beginLayer('editing', 'PRD 1-10: edit canvas, workflows, lineage');
    const result = await runEditingLayer(cfg, jwt);
    reporter.recordLayer({
      layer: 'editing',
      title: 'PRD 1-10: edit canvas, workflows, lineage',
      checks: result.checks,
      skipped: false,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  const { ok } = reporter.summary();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFatal error in smoke harness:', err instanceof Error ? err.message : err);
  process.exit(1);
});
