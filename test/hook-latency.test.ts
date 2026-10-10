import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles } from './helpers.js';

const QUIET_HOOK = "import { readFileSync } from 'node:fs';\nreadFileSync(0);\n";

function fixture(budget: unknown, hooks: readonly string[] = ['guard-bash', 'guard-secrets']): string {
  const root = tempDir();
  const files: Record<string, string> = { 'budgets.json': JSON.stringify({ hookLatency: budget }) };
  for (const hook of hooks) files[`dist/hooks/${hook}.mjs`] = QUIET_HOOK;
  writeFiles(root, files);
  return root;
}

const latency = (root: string, ...args: string[]) =>
  runScript('scripts/hook-latency.mjs', { args: [root, '--runs', '2', ...args] });

describe('hook-latency (ADR-0015, ADR-0017)', () => {
  it('reports each hook with its p50, p95 and budget, and writes the job summary', () => {
    const summary = path.join(tempDir(), 'summary.md');
    const result = runScript('scripts/hook-latency.mjs', {
      args: [fixture({ p95Ms: 10_000 }), '--runs', '2', '--gate'],
      env: { GITHUB_STEP_SUMMARY: summary },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\| guard-bash \| [\d.]+ ms \| [\d.]+ ms \| 10000 ms \|/);
    expect(result.stdout).toContain('Gated on');
    expect(readFileSync(summary, 'utf8')).toContain('### Hook latency');
  });

  it('fails a hook over its p95 budget only with --gate', () => {
    const root = fixture({ p95Ms: 0 });
    expect(latency(root).status).toBe(0);
    const gated = latency(root, '--gate');
    expect(gated.status).toBe(1);
    expect(gated.stderr).toMatch(/guard-bash has a p95 of [\d.]+ ms, over its 0 ms/);
  });

  it('fails a built hook that has no sample payloads to time', () => {
    const result = latency(fixture({ p95Ms: 10_000 }, ['guard-bash', 'mystery']));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('add sample payloads for mystery');
  });

  it('fails without a latency budget in budgets.json', () => {
    const result = latency(fixture(undefined));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('hookLatency.p95Ms');
  });
});
