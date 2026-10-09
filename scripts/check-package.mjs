#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { publint } from 'publint';
import { formatMessage } from 'publint/utils';
import { exitWith, npm } from './lib.mjs';

const SNAPSHOT = 'scripts/package-files.txt';
const RUNTIME_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
// husky's prepare is dev-only: release.yml deletes it from the manifest it publishes and checks that
// manifest with --release, so local and PR runs allow it.
const DEV_ONLY_SCRIPTS = new Set(['prepare']);
const HOOK_BUNDLE = /^dist\/hooks\/[^/]+\.mjs$/;
const BUDGET_KEYS = [
  ['tarball', 'maxBytes'],
  ['runtimeDependencies', 'max'],
  ['hookBundle', 'maxBytes'],
];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/** Reads budgets.json, exiting unless every expected budget is a non-negative finite number. */
function readBudgets(root) {
  const file = path.join(root, 'budgets.json');
  let budgets;
  try {
    budgets = readJson(file);
  } catch (error) {
    return exitWith(`check-package: cannot read ${file}: ${error.message}. Restore it (ADR-0017).`, 1);
  }
  const invalid = BUDGET_KEYS.filter(([group, limit]) => {
    const value = budgets?.[group]?.[limit];
    return typeof value !== 'number' || !Number.isFinite(value) || value < 0;
  });
  if (invalid.length > 0) {
    const keys = invalid.map((keyPath) => keyPath.join('.')).join(', ');
    exitWith(`check-package: budgets.json needs a non-negative number for ${keys} (ADR-0017).`, 1);
  }
  return budgets;
}

/** Fails on runtime dependencies beyond the budget and on scripts that run when users install. */
function manifestProblems(manifest, runtime, budgets, release) {
  const checked = release ? INSTALL_SCRIPTS : INSTALL_SCRIPTS.filter((name) => !DEV_ONLY_SCRIPTS.has(name));
  const scripts = checked.filter((name) => manifest.scripts?.[name] !== undefined);
  const problems = [];
  if (runtime.length > budgets.runtimeDependencies.max) {
    problems.push(
      `runtime dependencies over budget: ${runtime.join(', ')}. Make them devDependencies (ADR-0011).`,
    );
  }
  if (scripts.length > 0) {
    const strip = release ? ` (npm pkg delete ${scripts.map((name) => `scripts.${name}`).join(' ')})` : '';
    problems.push(`install scripts run on every user's machine; remove ${scripts.join(', ')}${strip}`);
  }
  return problems;
}

/** Compares the published file list with the committed snapshot, or rewrites it with `--update`. */
function snapshotProblems(root, files, update) {
  const actual = `${files.join('\n')}\n`;
  const snapshot = path.join(root, SNAPSHOT);
  if (update) writeFileSync(snapshot, actual);
  const expected = existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : '';
  if (expected === actual) return [];
  const before = expected.split('\n').filter(Boolean);
  const changes = [
    ...files.filter((file) => !before.includes(file)).map((file) => `  + ${file}`),
    ...before.filter((file) => !files.includes(file)).map((file) => `  - ${file}`),
  ];
  return [
    `published files differ from ${SNAPSHOT}:\n${changes.join('\n')}\n  If intended: npm run package -- --update`,
  ];
}

/** Measures the tarball and the bundles against the budgets, returning summary rows and problems. */
function measure(pack, runtime, budgets) {
  const rows = [
    ['Tarball', kB(pack.size), kB(budgets.tarball.maxBytes)],
    ['Unpacked', kB(pack.unpackedSize), ''],
    ['Files', String(pack.entryCount), ''],
    ['Runtime dependencies', String(runtime.length), String(budgets.runtimeDependencies.max)],
  ];
  const problems = [];
  if (pack.size > budgets.tarball.maxBytes) problems.push(`tarball is ${kB(pack.size)}, over its budget`);
  for (const { path: file, size } of pack.files.filter((entry) => entry.path.endsWith('.mjs'))) {
    const isHook = HOOK_BUNDLE.test(file);
    rows.push([file, kB(size), isHook ? kB(budgets.hookBundle.maxBytes) : '']);
    if (isHook && size > budgets.hookBundle.maxBytes) {
      problems.push(`${file} is ${kB(size)}, over its budget`);
    }
  }
  return { rows, problems };
}

/** Runs the built bin with --version and --help, the way a user would after installing. */
function binProblems(root, manifest) {
  const bin = path.join(root, Object.values(manifest.bin ?? {})[0] ?? '');
  try {
    const version = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim();
    const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    if (version !== manifest.version) return [`bin --version printed "${version}", not ${manifest.version}`];
    return help.includes('Usage:') ? [] : ['bin --help printed no usage'];
  } catch (error) {
    return [`bin ${path.relative(root, bin)} failed: ${String(error.message ?? error)}`];
  }
}

/** Lints the package as published, treating warnings as errors. */
async function publintProblems(root) {
  const { messages, pkg } = await publint({ pkgDir: root, level: 'warning', strict: true, pack: 'npm' });
  return messages.map(
    (message) => `publint: ${formatMessage(message, pkg, { color: false }) ?? message.code}`,
  );
}

/** Prints the size table, and appends it to the GitHub job summary when one is available. */
function report(rows) {
  const table = [
    '| Item | Size | Budget |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  process.stdout.write(`${table.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Package size\n\n${table.join('\n')}\n`);
  }
}

const args = process.argv.slice(2);
const root = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? '.');
const manifest = readJson(path.join(root, 'package.json'));
const budgets = readBudgets(root);
if (!existsSync(path.join(root, 'dist'))) {
  exitWith('check-package: dist/ is missing. Run npm run build first.', 1);
}

const runtime = RUNTIME_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}));
const packArgs = ['pack', '--dry-run', '--json', '--ignore-scripts'];
const [pack] = JSON.parse(npm(packArgs, { cwd: root, nextStep: 'Run it as npm run package.' }));
const files = pack.files.map((entry) => entry.path).sort();
const { rows, problems: budgetProblems } = measure(pack, runtime, budgets);
report(rows);
const problems = [
  ...manifestProblems(manifest, runtime, budgets, args.includes('--release')),
  ...snapshotProblems(root, files, args.includes('--update')),
  ...budgetProblems,
  ...binProblems(root, manifest),
  ...(await publintProblems(root)),
];
if (problems.length > 0) {
  exitWith(`Package check failed (budgets.json, ADR-0011, ADR-0017):\n${problems.join('\n')}`, 1);
}
