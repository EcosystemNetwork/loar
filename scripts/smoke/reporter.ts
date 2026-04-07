/**
 * Smoke harness reporter.
 * Tracks check results per layer and renders a terminal-friendly summary.
 * Emits structured JSON when --json flag is set (for CI parsing).
 */

const isTTY = process.stdout.isTTY;

const C = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  green: isTTY ? '\x1b[32m' : '',
  red: isTTY ? '\x1b[31m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  gray: isTTY ? '\x1b[90m' : '',
};

export interface CheckResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  detail?: string; // extra info on pass
  error?: string; // error message on fail
  durationMs?: number;
}

export interface LayerReport {
  layer: string; // machine label: "server" | "auth" | "storage" | "chain" | "indexer" | "ai"
  title: string; // human label
  checks: CheckResult[];
  skipped: boolean;
  skipReason?: string;
}

export class Reporter {
  private layers: LayerReport[] = [];
  private jsonMode: boolean;
  private quiet: boolean;

  constructor(opts: { json?: boolean; quiet?: boolean } = {}) {
    this.jsonMode = opts.json ?? false;
    this.quiet = opts.quiet ?? false;
  }

  header(serverUrl: string, indexerUrl: string, wallet: string | undefined, chainId: number) {
    if (this.jsonMode) return;
    const line = '─'.repeat(54);
    console.log('');
    console.log(`${C.bold}╔${'═'.repeat(54)}╗${C.reset}`);
    console.log(`${C.bold}║  LOAR Testnet Smoke Harness${' '.repeat(27)}║${C.reset}`);
    console.log(`${C.bold}╚${'═'.repeat(54)}╝${C.reset}`);
    console.log('');
    console.log(`  ${C.dim}Server ${C.reset} : ${serverUrl}`);
    console.log(`  ${C.dim}Indexer${C.reset} : ${indexerUrl}`);
    console.log(`  ${C.dim}Chain  ${C.reset} : Sepolia (${chainId})`);
    if (wallet) {
      const short = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
      console.log(`  ${C.dim}Wallet ${C.reset} : ${short}`);
    }
    console.log('');
    console.log(`  ${C.dim}${line}${C.reset}`);
    console.log('');
  }

  beginLayer(layer: string, title: string) {
    if (this.jsonMode) return;
    const pad = Math.max(0, 44 - title.length);
    console.log(`${C.bold}${C.cyan}  ── [${layer}] ${title} ${'─'.repeat(pad)}${C.reset}`);
  }

  recordLayer(report: LayerReport) {
    this.layers.push(report);

    if (this.jsonMode) return;

    if (report.skipped) {
      console.log(`  ${C.yellow}⊘${C.reset}  ${C.dim}skipped — ${report.skipReason}${C.reset}`);
      console.log('');
      return;
    }

    for (const c of report.checks) {
      this.printCheck(c);
    }
    console.log('');
  }

  private printCheck(c: CheckResult) {
    if (this.quiet && c.passed && !c.skipped) return;

    const ms = c.durationMs !== undefined ? ` ${C.dim}(${c.durationMs}ms)${C.reset}` : '';

    if (c.skipped) {
      console.log(`  ${C.yellow}⊘${C.reset}  ${C.dim}${c.name}${C.reset}${ms}`);
    } else if (c.passed) {
      const detail = c.detail ? `  ${C.gray}→ ${c.detail}${C.reset}` : '';
      console.log(`  ${C.green}✓${C.reset}  ${c.name}${detail}${ms}`);
    } else {
      console.log(`  ${C.red}✗${C.reset}  ${c.name}`);
      if (c.error) {
        console.log(`     ${C.red}${c.error}${C.reset}`);
      }
    }
  }

  summary(): { passed: number; failed: number; skipped: number; ok: boolean } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const l of this.layers) {
      if (l.skipped) {
        skipped++;
        continue;
      }
      for (const c of l.checks) {
        if (c.skipped) {
          skipped++;
        } else if (c.passed) {
          passed++;
        } else {
          failed++;
        }
      }
    }

    const ok = failed === 0;

    if (this.jsonMode) {
      console.log(JSON.stringify({ passed, failed, skipped, ok, layers: this.layers }, null, 2));
      return { passed, failed, skipped, ok };
    }

    const line = '═'.repeat(54);
    console.log(`${C.bold}  ${line}${C.reset}`);

    // Per-layer status line
    const statusLine = this.layers
      .map((l) => {
        if (l.skipped) return `${C.yellow}${l.layer} ⊘${C.reset}`;
        const anyFail = l.checks.some((c) => !c.passed && !c.skipped);
        return anyFail ? `${C.red}${l.layer} ✗${C.reset}` : `${C.green}${l.layer} ✓${C.reset}`;
      })
      .join('  ');

    console.log(`  ${statusLine}`);
    console.log('');

    if (ok) {
      console.log(
        `  ${C.green}${C.bold}${passed} passed${C.reset}` +
          (skipped ? `, ${C.yellow}${skipped} skipped${C.reset}` : '') +
          `, 0 failed`
      );
    } else {
      console.log(
        `  ${C.red}${C.bold}${failed} FAILED${C.reset}` +
          `, ${passed} passed` +
          (skipped ? `, ${C.yellow}${skipped} skipped${C.reset}` : '')
      );

      // Print failed check names for quick triage
      console.log('');
      console.log(`  ${C.red}${C.bold}Failed checks:${C.reset}`);
      for (const l of this.layers) {
        for (const c of l.checks) {
          if (!c.passed && !c.skipped) {
            console.log(`  ${C.red}✗${C.reset}  [${l.layer}] ${c.name}`);
            if (c.error) console.log(`       ${C.dim}${c.error}${C.reset}`);
          }
        }
      }
    }

    console.log(`${C.bold}  ${line}${C.reset}`);
    console.log('');

    return { passed, failed, skipped, ok };
  }
}

/** Run a named check and return the result. Never throws. */
export async function check(name: string, fn: () => Promise<string | void>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return {
      name,
      passed: true,
      detail: typeof detail === 'string' ? detail : undefined,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      passed: false,
      error: msg,
      durationMs: Date.now() - start,
    };
  }
}

/** A check that is intentionally skipped. */
export function skipped(name: string, reason?: string): CheckResult {
  return { name, passed: true, skipped: true, detail: reason };
}
