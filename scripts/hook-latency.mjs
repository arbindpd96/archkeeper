#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { exitWith } from './lib.mjs';

const USAGE = 'Usage: node scripts/hook-latency.mjs [<root>] [--gate] [--runs <n>]';
const EDITED_FILE = 'src/latency.ts';
// Built at run time, so this script holds no likely secret.
const TOKEN = `ghp_${'a'.repeat(36)}`;
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const write = (content) => ({ tool_name: 'Write', tool_input: { file_path: 'src/new.ts', content } });

// What each hook answers while it is timed: a common call, one it blocks and the heaviest it accepts.
const SAMPLES = {
  'guard-bash': [
    bash('npm test'),
    bash('git push origin main -f'),
    bash(`rm -${'rf'.repeat(3_900)}; git push --force origin main`),
  ],
  'guard-secrets': [
    write(`export const lines = [\n${'  "plain text",\n'.repeat(500)}];\n`),
    write(`const token = '${TOKEN}';\n`),
    {
      tool_name: 'Edit',
      tool_input: { file_path: EDITED_FILE, old_string: 'line 900', new_string: 'line 9000' },
    },
  ],
};

/** Reads the command line: the repository root, whether to gate on the budget, and the runs per payload. */
function readOptions() {
  try {
    const { values, positionals } = parseArgs({
      options: { gate: { type: 'boolean', default: false }, runs: { type: 'string', default: '20' } },
      allowPositionals: true,
    });
    const runs = Number(values.runs);
    if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs takes a positive whole number');
    return { root: path.resolve(positionals[0] ?? '.'), gate: values.gate, runs };
  } catch (error) {
    return exitWith(`hook-latency: ${error.message}\n${USAGE}`, 2);
  }
}

/** Reads `hookLatency.p95Ms` from budgets.json, or exits naming it. */
function readBudget(root) {
  try {
    const budget = JSON.parse(readFileSync(path.join(root, 'budgets.json'), 'utf8')).hookLatency?.p95Ms;
    if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 0) return budget;
  } catch (error) {
    return exitWith(`hook-latency: cannot read budgets.json: ${error.message}`, 1);
  }
  return exitWith(
    'hook-latency: budgets.json needs a non-negative number for hookLatency.p95Ms (ADR-0017).',
    1,
  );
}

/** A throwaway project the hooks run in, holding the file the guard-secrets sample edits. */
function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-latency-'));
  mkdirSync(path.join(dir, 'src'));
  const lines = Array.from({ length: 2_000 }, (_, index) => `// line ${index}`);
  writeFileSync(path.join(dir, EDITED_FILE), `${lines.join('\n')}\n`);
  return dir;
}

/** Times one run of a hook answering a payload on stdin, the way Claude Code runs it, in milliseconds. */
function timeRun(hook, payload, dir) {
  const start = performance.now();
  const run = spawnSync(process.execPath, [hook], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    timeout: 15_000,
  });
  const elapsed = performance.now() - start;
  if (run.status !== 0) {
    exitWith(`hook-latency: ${path.basename(hook)} exited ${run.status}: ${run.stderr}`, 1);
  }
  return elapsed;
}

/** The value at quantile `q` of sorted times. */
const quantile = (times, q) => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)];

/** Times every payload of a hook `runs` times after one warm-up run, returning p50 and p95. */
function measure(hook, payloads, dir, runs) {
  timeRun(hook, payloads[0], dir);
  const times = payloads.flatMap((payload) =>
    Array.from({ length: runs }, () => timeRun(hook, payload, dir)),
  );
  times.sort((a, b) => a - b);
  return { p50: quantile(times, 0.5), p95: quantile(times, 0.95) };
}

/** Prints the table, and appends it to the GitHub job summary when one is available. */
function report(rows, footer) {
  const table = ['| Hook | p50 | p95 | Budget (p95) |', '| --- | --- | --- | --- |', ...rows];
  process.stdout.write(`${table.join('\n')}\n\n${footer}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Hook latency\n\n${table.join('\n')}\n\n${footer}\n`);
  }
}

const options = readOptions();
const budget = readBudget(options.root);
const hooksDir = path.join(options.root, 'dist', 'hooks');
if (!existsSync(hooksDir)) exitWith('hook-latency: dist/hooks/ is missing. Run npm run build first.', 1);
const hooks = readdirSync(hooksDir)
  .filter((file) => file.endsWith('.mjs'))
  .sort();
const unsampled = hooks
  .map((file) => path.basename(file, '.mjs'))
  .filter((name) => !Object.hasOwn(SAMPLES, name));
if (unsampled.length > 0) {
  exitWith(`hook-latency: add sample payloads for ${unsampled.join(', ')} to SAMPLES.`, 1);
}

const work = project();
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const rows = [];
const problems = [];
for (const file of hooks) {
  const name = path.basename(file, '.mjs');
  const { p50, p95 } = measure(path.join(hooksDir, file), SAMPLES[name], work, options.runs);
  rows.push(`| ${name} | ${p50.toFixed(1)} ms | ${p95.toFixed(1)} ms | ${budget} ms |`);
  if (p95 > budget) problems.push(`${name} has a p95 of ${p95.toFixed(1)} ms, over its ${budget} ms.`);
}
const where = `${process.platform}, Node.js ${process.versions.node}`;
report(rows, options.gate ? `Gated on ${where}.` : `Reported, not gated, on ${where}.`);
if (options.gate && problems.length > 0) {
  exitWith(`Hook latency over budget (ADR-0015, ADR-0017):\n${problems.join('\n')}`, 1);
}
