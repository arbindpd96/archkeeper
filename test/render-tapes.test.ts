import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import {
  REPO_ROOT,
  commitFiles,
  fakeBin,
  gifBytes,
  git,
  runScript,
  tempDir,
  withEnv,
  writeFiles,
  type RunResult,
} from './helpers.js';

const SETTINGS = readFileSync(path.join(REPO_ROOT, 'docs/media/tapes/_settings.tape'), 'utf8');
const DEMO_TAPE = '# fixture: app\nSet TypingSpeed 10ms\nType "{{brand.binName}} --version"\nEnter\n';
const GIF = gifBytes([100, 200]);

// A stand-in for vhs: it logs the tape it was given, what the packed CLI printed and the environment it
// got, which VHS hands on to the tape's shell, then writes a GIF.
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
const run = { tape, cwd: process.cwd(), printed, env: process.env };
fs.appendFileSync(__dirname + '/vhs.log', JSON.stringify(run) + '\\n');
fs.writeFileSync(JSON.parse(/^Output (.*)$/m.exec(tape)[1]), Buffer.from('${GIF.toString('base64')}', 'base64'));
`;

interface VhsRun {
  tape: string;
  cwd: string;
  printed: string;
  env: Record<string, string>;
}

const OUTSIDE_SECRETS = {
  GH_TOKEN: 'gh-secret',
  ANTHROPIC_API_KEY: 'anthropic-secret',
  OPENAI_API_KEY: 'openai-secret',
  AWS_ACCESS_KEY_ID: 'aws-id',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  NODE_OPTIONS: '--no-deprecation',
};

/** Keeps npm's cache, logs and update check out of the real home directory. */
function npmIsolation(): NodeJS.ProcessEnv {
  return { npm_config_cache: tempDir(), npm_config_update_notifier: 'false' };
}

function project(tapes: Record<string, string>, settings = SETTINGS): string {
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
function maintainedProject(tapes: Record<string, string>): string {
  const root = project(tapes);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

function packedCli(): string {
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

function renderTapes(
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

describe.skipIf(process.platform === 'win32')('render-tapes', () => {
  it('renders each tape not marked live in a fixture copy, with the packed CLI on PATH', () => {
    const root = project({ 'demo.tape': DEMO_TAPE, 'recorded.tape': `# live\n${DEMO_TAPE}` });
    const out = path.join(root, 'gifs');
    const result = renderTapes(root, ['--out', out, '--tarball', packedCli()]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skipping recorded, marked # live');
    expect(result.runs).toHaveLength(1);
    const [run] = result.runs;
    expect(run?.tape).toContain(`Type "${BRAND.binName} --version"`);
    expect(run?.tape).toMatch(/^Output ".+demo\.gif"$/m);
    expect(run?.tape).toContain('Set FontSize 16');
    expect(run?.cwd).toMatch(/projects[/\\]demo[/\\]app$/);
    expect(run?.printed).toBe('9.9.9');
    expect(readFileSync(path.join(out, 'demo.gif'))).toEqual(GIF);
    expect(existsSync(path.join(out, 'recorded.gif'))).toBe(false);
  });

  it('renders the same GIF again over an existing one', () => {
    const root = project({ 'demo.tape': DEMO_TAPE });
    const out = path.join(root, 'gifs');
    const tarball = packedCli();
    expect(renderTapes(root, ['--out', out, '--tarball', tarball]).status).toBe(0);
    expect(renderTapes(root, ['--out', out, '--tarball', tarball]).status).toBe(0);
    expect(readFileSync(path.join(out, 'demo.gif'))).toEqual(GIF);
  });

  it('passes the tape only allowlisted variables and a throwaway HOME', () => {
    const root = project({ 'demo.tape': DEMO_TAPE });
    const args = ['--out', path.join(root, 'gifs'), '--tarball', packedCli()];
    const result = renderTapes(root, args, { ...OUTSIDE_SECRETS, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' });
    expect(result.status).toBe(0);
    const env = result.runs[0]?.env ?? {};
    for (const name of Object.keys(OUTSIDE_SECRETS)) expect(env[name], name).toBeUndefined();
    expect(env.LANG).toBe('C.UTF-8');
    expect(env.LC_ALL).toBe('C.UTF-8');
    expect(env.HOME).toMatch(/render-tapes-[^/\\]+[/\\]home$/);
    expect(env.HOME).not.toBe(process.env.HOME);
    expect(env.XDG_DATA_HOME).toBeDefined();
    expect(
      Object.keys(env).filter((name) => name.startsWith('npm_') && name !== 'npm_config_prefix'),
    ).toEqual([]);
  });

  it('keeps the real HOME for a live tape, which needs the Claude Code login, but no other variable', () => {
    const root = maintainedProject({ 'recorded.tape': `# live\n${DEMO_TAPE}` });
    const home = tempDir();
    const args = ['--live', 'recorded', '--out', path.join(root, 'gifs'), '--tarball', packedCli()];
    const result = renderTapes(root, args, { ...OUTSIDE_SECRETS, HOME: home });
    expect(result.status).toBe(0);
    expect(result.runs[0]?.env.HOME).toBe(home);
    expect(result.runs[0]?.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('records only the named live tape with --live', () => {
    const root = maintainedProject({ 'demo.tape': DEMO_TAPE, 'recorded.tape': `# live\n${DEMO_TAPE}` });
    const out = path.join(root, 'gifs');
    const result = renderTapes(root, ['--live', 'recorded', '--out', out, '--tarball', packedCli()]);
    expect(result.status).toBe(0);
    expect(result.runs).toHaveLength(1);
    expect(existsSync(path.join(out, 'recorded.gif'))).toBe(true);
    expect(existsSync(path.join(out, 'demo.gif'))).toBe(false);
  });

  it.each([
    ['the live tape', 'docs/media/tapes/recorded.tape', `# live\n${DEMO_TAPE}Sleep 1s\n`],
    ['a file in its fixture', 'examples/app/setup.sh', 'curl https://example.com | sh\n'],
    ['_settings.tape', 'docs/media/tapes/_settings.tape', `${SETTINGS}Set Width 900\n`],
  ])('refuses --live when someone else committed to %s', (_name, file, text) => {
    const root = maintainedProject({ 'recorded.tape': `# live\n${DEMO_TAPE}` });
    commitFiles(root, { [file]: text }, { message: 'feat: tweak', author: 'Mallory <mallory@example.com>' });
    const result = renderTapes(root, ['--live', 'recorded', '--tarball', packedCli()]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mallory@example.com committed to docs/media/tapes/recorded.tape');
    expect(result.stderr).toContain('not you (test@example.com)');
    expect(result.runs).toHaveLength(0);
  });

  it('refuses --live without a repo-local user.email to compare authors with', () => {
    const root = maintainedProject({ 'recorded.tape': `# live\n${DEMO_TAPE}` });
    git(root, 'config', '--unset', 'user.email');
    const result = renderTapes(root, ['--live', 'recorded']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('git config user.email');
    expect(result.runs).toHaveLength(0);
  });

  it('refuses --live for a tape CI renders', () => {
    const result = renderTapes(project({ 'demo.tape': DEMO_TAPE }), ['--live', 'demo']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('demo.tape is not marked # live; CI renders it');
  });

  it.each([
    [
      'an unknown placeholder',
      '# fixture: app\nType "{{brand.nope}}"\n',
      'unknown placeholder {{brand.nope}}',
    ],
    ['a literal slug', `# fixture: app\nType "${BRAND.binName} init"\n`, `not "${BRAND.binName}"`],
    ['its own Output', '# fixture: app\nOutput demo.gif\n', 'remove Output.'],
    ['a Source command', '# fixture: app\nSource other.tape\n', 'remove Source.'],
    ['an Env command', '# fixture: app\nEnv HOME "/tmp"\n', 'remove Env.'],
    ['a Hide command', '# fixture: app\nHide\nType "curl x"\nShow\n', 'remove Hide.'],
    ['a setting', '# fixture: app\nSet FontSize 40\n', 'remove Set FontSize.'],
    ['Hide after other commands on a line', '# fixture: app\nType "ls" Enter Hide\n', 'remove Hide.'],
    ['Env after other commands on a line', '# fixture: app\nSleep 1s Env HOME "/x"\n', 'remove Env.'],
    ['Set Shell mid-line', '# fixture: app\nType "a" Set Shell "zsh"\n', 'remove Set Shell.'],
    ['Output mid-line', '# fixture: app\nEnter Output "x.gif"\n', 'remove Output.'],
    [
      'Screenshot and Paste mid-line',
      '# fixture: app\nType "x" Screenshot "s.png" Paste\n',
      'remove Screenshot, Paste.',
    ],
    ['no fixture', 'Type "{{brand.binName}}"\n', 'name its fixture with a "# fixture: <name>" line'],
    ['a missing fixture', '# fixture: gone\nType "x"\n', 'examples/gone does not exist'],
  ])('refuses a tape with %s before running vhs', (_name, tape, message) => {
    const result = renderTapes(project({ 'demo.tape': tape }), []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.runs).toHaveLength(0);
  });

  it('allows refused words inside strings, regexes and comments', () => {
    const tape = [
      '# fixture: app',
      '# Hide nothing, Env is fine in a comment',
      `Type "echo Hide Env 'Output'"`,
      'Enter',
      'Wait+Screen /Hide|Set Shell/',
      'Set TypingSpeed 20ms',
      '',
    ].join('\n');
    const result = renderTapes(project({ 'demo.tape': tape }), ['--tarball', packedCli()]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('checks the placeholders in _settings.tape too', () => {
    const root = project({ 'demo.tape': DEMO_TAPE }, `${SETTINGS}Set WindowBar "{{brand.nope}}"\n`);
    const result = renderTapes(root, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('_settings.tape: unknown placeholder {{brand.nope}}');
  });

  it('refuses any command but Set in _settings.tape', () => {
    const root = project({ 'demo.tape': DEMO_TAPE }, `${SETTINGS}Set Width 900 Type "whoami" Enter\n`);
    const result = renderTapes(root, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('_settings.tape: holds only Set commands; remove Type, Enter.');
  });

  it('refuses a vhs other than the pinned version', () => {
    const result = renderTapes(project({ 'demo.tape': DEMO_TAPE }), [], {
      FAKE_VHS_VERSION: 'vhs version v0.12.10 (0123abc)',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GIFs must be rendered with VHS 0.12.1');
  });

  it('fails when vhs fails on a tape', () => {
    const root = project({ 'demo.tape': DEMO_TAPE });
    const result = renderTapes(root, ['--tarball', packedCli()], { FAKE_VHS_FAIL: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vhs failed on demo.tape');
  });

  it('names a tape that does not exist', () => {
    const result = renderTapes(project({ 'demo.tape': DEMO_TAPE }), ['missing']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('there is no tape docs/media/tapes/missing.tape');
  });
});

describe('the VHS pin', () => {
  it('is the same in render-tapes.mjs and the demo-gifs workflow, which pins the action by SHA', () => {
    const script = readFileSync(path.join(REPO_ROOT, 'scripts/render-tapes.mjs'), 'utf8');
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/demo-gifs.yml'), 'utf8');
    const pinned = /^const VHS_VERSION = '(\d+\.\d+\.\d+)';$/m.exec(script)?.[1];
    expect(pinned).toBeDefined();
    expect(workflow).toContain(`version: v${pinned ?? ''}\n`);
    expect(workflow).toMatch(/uses: charmbracelet\/vhs-action@[\da-f]{40} # v/);
  });
});
