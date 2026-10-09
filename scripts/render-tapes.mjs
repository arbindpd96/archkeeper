#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
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
import { parseArgs } from 'node:util';
import { BRAND } from '../src/core/brand.ts';
import { exitWith, npm } from './lib.mjs';

// Pinned with the vhs-action input in .github/workflows/demo-gifs.yml; a test keeps the two equal.
const VHS_VERSION = '0.12.1';
const TAPES = 'docs/media/tapes';
const SETTINGS = '_settings.tape';
const TAPE_NAME = /^_?[a-z0-9][a-z0-9-]*$/;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const FIXTURE = /^#\s*fixture:\s*(\S+)\s*$/m;
const LIVE = /^#\s*live\s*$/m;
const OWNED_COMMANDS = /^\s*(Output|Source)\b/m;
const SLUGS = [...new Set([BRAND.npmName, BRAND.binName, BRAND.pluginName, BRAND.marketplaceName])];
const USAGE =
  'Usage: node scripts/render-tapes.mjs [<feature>...] [--out <dir>] [--tarball <file>]\n' +
  '       node scripts/render-tapes.mjs --live <feature> [--out <dir>] [--tarball <file>]';

/** Reads the command line: tapes to render (default all), the GIF folder, the tarball, or one live tape. */
function readOptions() {
  try {
    const { values, positionals } = parseArgs({
      options: {
        out: { type: 'string', default: 'docs/media' },
        tarball: { type: 'string' },
        live: { type: 'string' },
      },
      allowPositionals: true,
    });
    if (values.live !== undefined && positionals.length > 0) throw new Error('--live takes one tape');
    return { ...values, features: positionals };
  } catch (error) {
    return exitWith(`render-tapes: ${error.message}\n${USAGE}`, 2);
  }
}

/** Replaces `{{brand.<key>}}` with the BRAND string, collecting any placeholder that is not one. */
function fillPlaceholders(text, unknown = []) {
  return text.replace(PLACEHOLDER, (match, key) => {
    const [scope, name, ...rest] = key.split('.');
    const known = scope === 'brand' && rest.length === 0 && Object.hasOwn(BRAND, name);
    if (known && typeof BRAND[name] === 'string') return BRAND[name];
    unknown.push(match);
    return match;
  });
}

/** Lists what any tape text must not contain: commands render-tapes owns, slugs, unknown placeholders. */
function textProblems(label, text) {
  const problems = [];
  if (OWNED_COMMANDS.test(text)) {
    problems.push(`${label}: remove Output and Source; render-tapes adds the output path and ${SETTINGS}.`);
  }
  const slug = SLUGS.find((candidate) => text.includes(candidate));
  if (slug !== undefined)
    problems.push(`${label}: write {{brand.binName}} or another {{brand.*}}, not "${slug}".`);
  const unknown = [];
  fillPlaceholders(text, unknown);
  for (const match of unknown) problems.push(`${label}: unknown placeholder ${match}; use {{brand.<key>}}.`);
  return problems;
}

/** Lists why a tape cannot be rendered, including a missing or unknown fixture. */
function tapeProblems(root, tape) {
  const label = `${TAPES}/${tape.feature}.tape`;
  const problems = textProblems(label, tape.text);
  if (tape.fixture === undefined || !TAPE_NAME.test(tape.fixture)) {
    problems.push(`${label}: name its fixture with a "# fixture: <name>" line (a folder in examples/).`);
  } else if (!existsSync(path.join(root, 'examples', tape.fixture))) {
    problems.push(`${label}: examples/${tape.fixture} does not exist.`);
  }
  return problems;
}

/** Reads one tape by feature name, or exits when there is no such tape. */
function readTape(root, feature) {
  const file = path.join(root, TAPES, `${feature}.tape`);
  if (!TAPE_NAME.test(feature) || `${feature}.tape` === SETTINGS || !existsSync(file)) {
    return exitWith(`render-tapes: there is no tape ${TAPES}/${feature}.tape.`, 1);
  }
  const text = readFileSync(file, 'utf8');
  return { feature, text, live: LIVE.test(text), fixture: FIXTURE.exec(text)?.[1] };
}

/** Picks the tapes to render: one live tape with --live, else the named or all tapes not marked live. */
function selectTapes(root, options) {
  if (options.live !== undefined) {
    const tape = readTape(root, options.live);
    if (!tape.live) exitWith(`render-tapes: ${options.live}.tape is not marked # live; CI renders it.`, 1);
    return [tape];
  }
  const all = readdirSync(path.join(root, TAPES))
    .filter((file) => file.endsWith('.tape') && file !== SETTINGS)
    .map((file) => file.slice(0, -'.tape'.length))
    .sort();
  const tapes = (options.features.length > 0 ? options.features : all).map((name) => readTape(root, name));
  for (const tape of tapes.filter((candidate) => candidate.live)) {
    process.stdout.write(`render-tapes: skipping ${tape.feature}, marked # live (record it with --live).\n`);
  }
  return tapes.filter((tape) => !tape.live);
}

/** Exits unless the vhs on PATH is the version CI pins, so local and CI GIFs match. */
function requireVhs() {
  let printed = '';
  try {
    printed = execFileSync('vhs', ['--version'], { encoding: 'utf8' });
  } catch {
    exitWith(
      `render-tapes: vhs is not installed. Install VHS ${VHS_VERSION} with ttyd and ffmpeg ` +
        '(https://github.com/charmbracelet/vhs), or push and let the demo-gifs workflow render it.',
      1,
    );
  }
  if (!new RegExp(String.raw`\bv?${VHS_VERSION.replaceAll('.', String.raw`\.`)}\b`).test(printed)) {
    exitWith(`render-tapes: found ${printed.trim()}, but GIFs must be rendered with VHS ${VHS_VERSION}.`, 1);
  }
}

/** Packs the repository (or takes `tarball`) and installs it globally under `work`, returning the prefix. */
function installCli(root, work, tarball) {
  let packed = tarball === undefined ? undefined : path.resolve(tarball);
  if (packed === undefined) {
    if (!existsSync(path.join(root, 'dist')))
      exitWith('render-tapes: dist/ is missing. Run npm run build first.', 1);
    const args = ['pack', '--ignore-scripts', '--json', '--pack-destination', work];
    const nextStep = 'Run it from the repository root after npm run build.';
    packed = path.join(work, JSON.parse(npm(args, { cwd: root, nextStep }))[0].filename);
  }
  const prefix = path.join(work, 'cli');
  const install = ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund'];
  npm([...install, packed], { cwd: work, nextStep: `Check that ${packed} is a package tarball.` });
  return prefix;
}

/** Builds the tape vhs runs: its output path, the shared settings, then the tape, with placeholders filled. */
function renderedTape(settings, tape, gif) {
  const header = `# Rendered from ${TAPES}/${tape.feature}.tape by scripts/render-tapes.mjs.`;
  return fillPlaceholders([header, `Output ${JSON.stringify(gif)}`, settings, tape.text].join('\n'));
}

/** Copies the tape's fixture, renders the tape in it with vhs, and copies the GIF to `out`. */
function render(tape, { root, work, env, settings, out }) {
  const project = path.join(work, 'projects', tape.feature, tape.fixture);
  const gif = path.join(work, 'gifs', `${tape.feature}.gif`);
  const script = path.join(work, 'tapes', `${tape.feature}.tape`);
  cpSync(path.join(root, 'examples', tape.fixture), project, { recursive: true });
  mkdirSync(path.dirname(gif), { recursive: true });
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, renderedTape(settings, tape, gif));
  try {
    execFileSync('vhs', [script], { cwd: project, env, stdio: 'inherit' });
  } catch {
    exitWith(`render-tapes: vhs failed on ${tape.feature}.tape; see its output above.`, 1);
  }
  if (!existsSync(gif)) exitWith(`render-tapes: vhs wrote no GIF for ${tape.feature}.tape.`, 1);
  mkdirSync(out, { recursive: true });
  copyFileSync(gif, path.join(out, `${tape.feature}.gif`));
  process.stdout.write(`render-tapes: wrote ${path.join(out, `${tape.feature}.gif`)}\n`);
}

const options = readOptions();
const root = process.cwd();
const settingsFile = path.join(root, TAPES, SETTINGS);
if (!existsSync(settingsFile))
  exitWith(`render-tapes: ${TAPES}/${SETTINGS} is missing; run it from the repo root.`, 1);
const settings = readFileSync(settingsFile, 'utf8');
const tapes = selectTapes(root, options);
const problems = [
  ...textProblems(`${TAPES}/${SETTINGS}`, settings),
  ...tapes.flatMap((tape) => tapeProblems(root, tape)),
];
if (problems.length > 0) exitWith(`render-tapes: cannot render:\n${problems.join('\n')}`, 1);
if (tapes.length === 0) {
  process.stdout.write('render-tapes: no tapes to render.\n');
  process.exit(0);
}

requireVhs();
const work = mkdtempSync(path.join(tmpdir(), 'render-tapes-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const prefix = installCli(root, work, options.tarball);
// The packed CLI comes first on PATH, and npm_config_prefix lets `npx <bin>` find it offline too.
const env = {
  ...process.env,
  PATH: `${path.join(prefix, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  npm_config_prefix: prefix,
};
for (const tape of tapes) render(tape, { root, work, env, settings, out: path.resolve(options.out) });
