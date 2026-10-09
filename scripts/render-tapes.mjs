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
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { exitWith, git, npm } from './lib.mjs';
import {
  fillPlaceholders,
  SETTINGS,
  settingsProblems,
  TAPE_NAME,
  TAPES,
  tapeProblems,
} from './tape-rules.mjs';

// Pinned with the vhs-action input in .github/workflows/demo-gifs.yml; a test keeps the two equal.
const VHS_VERSION = '0.12.1';
const FIXTURE = /^#\s*fixture:\s*(\S+)\s*$/m;
const LIVE = /^#\s*live\s*$/m;
// Everything else, such as tokens, SSH_AUTH_SOCK, cloud keys and npm config, stays out of the tape's shell.
const PASSED_ENV = /^(?:PATH|TERM|COLORTERM|LANG|LC_\w+|TZ|TMPDIR|VHS_\w+)$/;
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

/** Exits unless every commit to a live tape, the settings or its fixture is the maintainer's (repo-local email). */
function requireMaintainerAuthored(root, tape) {
  const maintainer = git(['config', '--local', 'user.email'], {
    cwd: root,
    action: 'read the repo-local user.email',
    nextStep: 'Set your identity in this repository first: git config user.email <you@example.com>.',
  }).trim();
  const paths = [`${TAPES}/${tape.feature}.tape`, `${TAPES}/${SETTINGS}`, `examples/${tape.fixture}`];
  const log = git(['log', '--format=%ae', '--', ...paths], {
    cwd: root,
    action: `list who changed ${paths.join(', ')}`,
    nextStep: 'Run it from the repository root.',
  });
  const others = [...new Set(log.split('\n').filter((email) => email !== '' && email !== maintainer))];
  if (others.length > 0) {
    exitWith(
      `render-tapes: --live runs ${tape.feature}.tape in your own shell, but ${others.join(', ')} ` +
        `committed to ${paths.join(', ')}, not you (${maintainer}). Record live only tapes and fixtures ` +
        'that you alone committed, after reviewing them.',
      1,
    );
  }
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

/**
 * The environment for vhs, which hands it on to the tape's shell: only allowlisted variables, the packed
 * CLI first on PATH (npm_config_prefix lets `npx <bin>` find it offline too), and the given HOME.
 */
function tapeEnv(prefix, home) {
  const passed = Object.entries(process.env).filter(([name]) => PASSED_ENV.test(name));
  return {
    ...Object.fromEntries(passed),
    HOME: home,
    // fontconfig still finds the fonts vhs-action installs under the real HOME's ~/.local/share.
    XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'),
    PATH: `${path.join(prefix, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
    npm_config_prefix: prefix,
  };
}

/** Builds the tape vhs runs:its output path, the shared settings, then the tape, with placeholders filled. */
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
const problems = [...settingsProblems(settings), ...tapes.flatMap((tape) => tapeProblems(root, tape))];
if (problems.length > 0) exitWith(`render-tapes: cannot render:\n${problems.join('\n')}`, 1);
if (tapes.length === 0) {
  process.stdout.write('render-tapes: no tapes to render.\n');
  process.exit(0);
}

if (options.live !== undefined) requireMaintainerAuthored(root, tapes[0]);
requireVhs();
const work = mkdtempSync(path.join(tmpdir(), 'render-tapes-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const prefix = installCli(root, work, options.tarball);
const home = options.live === undefined ? path.join(work, 'home') : homedir();
mkdirSync(home, { recursive: true });
const env = tapeEnv(prefix, home);
for (const tape of tapes) render(tape, { root, work, env, settings, out: path.resolve(options.out) });
