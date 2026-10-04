#!/usr/bin/env node
// Dependency vulnerability audit against the npm bulk advisory endpoint.
//
// `pnpm audit` (v9 and v10) OOMs on this lockfile even with an 8 GB heap — it
// materialises every dependency path before reporting. This script skips the
// path walk: it reads the resolved name@version set straight from the
// `packages:` section of pnpm-lock.yaml and posts it to the same endpoint
// npm itself uses, in chunks.
//
// Usage: node scripts/audit-deps.mjs [--audit-level=high] [--json]
// Exits 1 when any advisory at or above the audit level affects an installed version.
// Accepted advisories go in .audit-allowlist.json as { "<GHSA id or url>": "reason" }.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const CHUNK = 400;

const args = process.argv.slice(2);
const level = (
  args.find((a) => a.startsWith('--audit-level='))?.split('=')[1] ?? 'high'
).toLowerCase();
const asJson = args.includes('--json');
if (!LEVELS.includes(level)) {
  console.error(`Unknown --audit-level=${level}`);
  process.exit(2);
}

const allowPath = resolve(ROOT, '.audit-allowlist.json');
const allowlist = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};

// ── Collect name → versions from the lockfile's packages: section ──
const lock = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8').split('\n');
const versions = new Map();
let inPackages = false;
for (const line of lock) {
  if (/^\S/.test(line)) inPackages = line.startsWith('packages:');
  if (!inPackages) continue;
  const m = line.match(/^ {2}'?((?:@[^/@\s]+\/)?[^@\s']+)@([^'(:\s]+)/);
  if (!m) continue;
  const [, name, version] = m;
  if (!/^\d+\.\d+\.\d+/.test(version)) continue; // git/tarball/link deps aren't in the advisory DB
  if (!versions.has(name)) versions.set(name, new Set());
  versions.get(name).add(version);
}

// ── Query in chunks ──
const entries = [...versions.entries()];
const advisories = {};
for (let i = 0; i < entries.length; i += CHUNK) {
  const body = Object.fromEntries(entries.slice(i, i + CHUNK).map(([n, v]) => [n, [...v]]));
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Advisory endpoint returned ${res.status}: ${await res.text()}`);
    process.exit(2);
  }
  Object.assign(advisories, await res.json());
}

// ── Match advisories to installed versions ──
// The bulk endpoint already filters to advisories affecting at least one of the
// versions sent, but not which one — report every installed version of the
// package and let the reader cross-check against vulnerable_versions.
const minIdx = LEVELS.indexOf(level);
const findings = [];
for (const [name, list] of Object.entries(advisories)) {
  for (const a of list) {
    if (LEVELS.indexOf(a.severity) < minIdx) continue;
    const id = a.url?.split('/').pop() ?? String(a.id);
    findings.push({
      severity: a.severity,
      name,
      installed: [...versions.get(name)].join(', '),
      vulnerable: a.vulnerable_versions,
      title: a.title,
      id,
      allowed: allowlist[id] ?? allowlist[a.url] ?? null,
    });
  }
}
findings.sort(
  (a, b) => LEVELS.indexOf(b.severity) - LEVELS.indexOf(a.severity) || a.name.localeCompare(b.name)
);
const blocking = findings.filter((f) => !f.allowed);

if (asJson) {
  console.log(JSON.stringify({ packages: versions.size, findings }, null, 2));
} else {
  console.log(`Audited ${versions.size} packages (level ≥ ${level}).`);
  for (const f of findings) {
    const tag = f.allowed ? ` [allowlisted: ${f.allowed}]` : '';
    console.log(
      `${f.severity.padEnd(8)} ${f.name}@${f.installed}  vulnerable ${f.vulnerable}  ${f.id}  ${f.title}${tag}`
    );
  }
  console.log(
    blocking.length ? `\n${blocking.length} blocking advisories.` : '\nNo blocking advisories.'
  );
}
process.exit(blocking.length ? 1 : 0);
