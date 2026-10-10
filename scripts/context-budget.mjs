#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { alwaysOnContext } from './context-rules.mjs';
import { exitWith } from './lib.mjs';

// The fixtures each preset is measured on; the largest result counts against the budget.
const FIXTURES = ['ts-app', 'py-app', 'mixed'];
const root = process.cwd();
const bin = path.join(root, 'dist', 'cli.mjs');

/** Reads a JSON file of the repository, or exits naming it. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    return exitWith(`context-budget: cannot read ${file}: ${error.message}. Run it from the repo root.`, 1);
  }
}

/** Runs the built CLI's `init --yes` for a preset in a fresh copy of a fixture, exiting with its error on failure. */
function initCopy(work, preset, fixture) {
  const project = path.join(work, preset, fixture);
  cpSync(path.join(root, 'examples', fixture), project, { recursive: true });
  try {
    execFileSync(process.execPath, [bin, 'init', '--yes', '--preset', preset, '--cwd', project], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (error) {
    exitWith(
      `context-budget: init --preset ${preset} failed on examples/${fixture}:\n${error.stderr ?? error.message}`,
      1,
    );
  }
  return project;
}

/** Measures one preset on every fixture and returns the largest measurement with its fixture. */
function measurePreset(work, { name, defaults }) {
  const measured = FIXTURES.map((fixture) => ({
    fixture,
    ...alwaysOnContext(initCopy(work, name, fixture), defaults.sessionStartCap),
  }));
  return measured.reduce((worst, next) => (next.tokens > worst.tokens ? next : worst));
}

/** Prints the table, and appends it to the GitHub job summary when one is available. */
function report(rows) {
  const table = [
    '| Preset | Always-on tokens | Budget | Largest on | CLAUDE.md and imports | Rules | Skills | SessionStart cap |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  process.stdout.write(`${table.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Always-on context\n\n${table.join('\n')}\n`);
  }
}

if (!existsSync(bin)) exitWith('context-budget: dist/cli.mjs is missing. Run npm run build first.', 1);
const budgets = readJson('budgets.json').alwaysOnContext ?? {};
const { presets } = readJson('modules/presets.json');
const work = mkdtempSync(path.join(tmpdir(), 'context-budget-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const rows = [];
const problems = [];
for (const preset of presets) {
  const worst = measurePreset(work, preset);
  const budget = budgets[preset.name];
  if (typeof budget !== 'number') problems.push(`budgets.json has no alwaysOnContext.${preset.name}.`);
  else if (worst.tokens > budget) {
    problems.push(
      `${preset.name} loads ${worst.tokens} tokens in every session on examples/${worst.fixture}, over its ${budget}.`,
    );
  }
  const { instructions, rules, skills, sessionStart } = worst;
  const chars = [instructions, rules, skills, sessionStart].map((value) => `${value} chars`);
  rows.push([preset.name, String(worst.tokens), String(budget), worst.fixture, ...chars]);
}
report(rows);
if (problems.length > 0) {
  exitWith(
    `Context budget exceeded (ADR-0017; raising a budget needs an ADR note):\n${problems.join('\n')}`,
    1,
  );
}
