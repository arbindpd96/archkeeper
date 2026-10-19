import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/core/brand.js';
import {
  REPO_ROOT,
  fakeBin,
  gifBytes,
  git,
  runScript,
  tempDir,
  withEnv,
  writeFiles,
  type RunResult,
} from './helpers.js';

export const SETTINGS = readFileSync(path.join(REPO_ROOT, 'docs/media/tapes/_settings.tape'), 'utf8');
export const DEMO_TAPE = '# fixture: app\nSet TypingSpeed 10ms\nType "{{brand.binName}} --version"\nEnter\n';
export const GIF = gifBytes([100, 200]);

// A stand-in for vhs: it logs the tape it was given, what the packed CLI printed, the environment it got,
// which VHS hands on to the tape's shell, and the fixture copy's commits, status and local core.hooksPath
// folder when it is a git repository, then writes a GIF.
const FAKE_VHS = `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const [arg] = process.argv.slice(2);
if (arg === '--version') {
  process.stdout.write(process.env.FAKE_VHS_VERSION + '\\n');
  process.exit(0);
}
if (fs.existsSync(__dirname + '/fail')) process.exit(1);
const tape = fs.readFileSync(arg, 'utf8');
const printed = execFileSync('${BRAND.binName}', ['--version'], { encoding: 'utf8' }).trim();
const gitOutput = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const repo = fs.existsSync('.git')
  ? { commits: gitOutput(['rev-list', '--count', 'HEAD']), status: gitOutput(['status', '--porcelain']) }
  : null;
const hooksPath = repo === null ? '' : gitOutput(['config', '--local', '--default', '', 'core.hooksPath']);
const hooks = hooksPath === '' ? null : { path: fs.realpathSync(hooksPath), files: fs.readdirSync(hooksPath) };
const run = { tape, cwd: process.cwd(), printed, env: process.env, repo, hooks };
fs.appendFileSync(__dirname + '/vhs.log', JSON.stringify(run) + '\\n');
fs.writeFileSync(JSON.parse(/^Output (.*)$/m.exec(tape)[1]), Buffer.from('${GIF.toString('base64')}', 'base64'));
`;

/** What the stand-in vhs logged about one tape it was given. */
export interface VhsRun {
  tape: string;
  cwd: string;
  printed: string;
  env: Record<string, string>;
  repo: { commits: string; status: string } | null;
  hooks: { path: string; files: string[] } | null;
}

/** Keeps npm's cache, logs and update check out of the real home directory. */
function npmIsolation(): NodeJS.ProcessEnv {
  return { npm_config_cache: tempDir(), npm_config_update_notifier: 'false' };
}

/** A temp project holding the given tapes, the shared settings tape and an `app` fixture. */
export function project(tapes: Record<string, string>, settings = SETTINGS): string {
  const root = tempDir();
  const files = Object.fromEntries(
    Object.entries(tapes).map(([name, text]) => [`docs/media/tapes/${name}`, text]),
  );
  writeFiles(root, {
    'docs/media/tapes/_settings.tape': settings,
    'examples/app/README.md': '# App\n',
    ...files,
  });
  return root;
}

/** A project committed by the maintainer, test@example.com, which is also its repo-local user.email. */
export function maintainedProject(tapes: Record<string, string>): string {
  const root = project(tapes);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/** Packs a stand-in CLI whose `--version` prints 9.9.9 and returns the tarball's path. */
export function packedCli(): string {
  const dir = tempDir();
  writeFiles(dir, {
    'package.json': JSON.stringify({
      name: 'fixture-kit',
      version: '9.9.9',
      bin: { [BRAND.binName]: 'cli.js' },
    }),
    'cli.js': "#!/usr/bin/env node\nprocess.stdout.write('9.9.9\\n');\n",
  });
  const packed = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
    cwd: dir,
    encoding: 'utf8',
    env: withEnv(npmIsolation()),
  });
  return path.join(dir, (JSON.parse(packed) as { filename: string }[])[0]?.filename ?? '');
}

/** Runs render-tapes in `root` with the stand-in vhs first on PATH, and returns what each vhs run logged. */
export function renderTapes(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): RunResult & { runs: VhsRun[] } {
  const bin = fakeBin('vhs', FAKE_VHS);
  const log = path.join(bin, 'vhs.log');
  // The tape's environment is allowlisted, so the stand-in reads its controls from files beside it.
  writeFiles(bin, { 'vhs.log': '', ...(env.FAKE_VHS_FAIL === undefined ? {} : { fail: '' }) });
  const result = runScript('scripts/render-tapes.mjs', {
    args,
    cwd: root,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      FAKE_VHS_VERSION: 'vhs version v0.12.1 (0123abc)',
      ...npmIsolation(),
      ...env,
    },
  });
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { ...result, runs: lines.map((line) => JSON.parse(line) as VhsRun) };
}
