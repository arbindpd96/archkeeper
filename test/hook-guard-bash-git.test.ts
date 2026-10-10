import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardBash } from '../src/hooks/runtime/bash/guard.js';
import { BRAND } from '../src/core/brand.js';
import { bashContext, bashDecision, bashVerdict, hookAnswer } from './hook-helpers.js';
import { tempDir, writeFiles } from './helpers.js';

const RUNS_PROGRAM = /git can run a program this config or environment names/;

describe('guard-bash parser fixes (#31)', () => {
  it.each([
    'echo $((1 << 2))',
    'echo "$(( (a + b) * 2 ))"',
    'x=$((x+1))',
    'arr=(rm -rf ~)',
    'declare -a arr=(rm -rf /)',
    'arr+=(git push -f)',
    'arr=(\n  a # rm -rf ~\n  b\n)',
    'echo $((echo hi) )',
  ])('reads %j as words, not commands', (command) => {
    expect(bashDecision(command)).toBe('allow');
  });

  it.each(['echo $(( $(rm -rf ~) ))', 'echo $(( `rm -rf ~` ))', 'arr=($(rm -rf ~))', 'arr=("$(rm -rf /)")'])(
    'still judges the substitution in %j',
    (command) => {
      expect(bashDecision(command)).toBe('deny');
    },
  );

  it.each(['arr=(a; b)', 'arr=(a', 'echo $(( 1 + 2'])('asks about %j, which cannot be read', (command) => {
    expect(bashDecision(command)).toBe('ask');
  });
});

describe('guard-bash on git running programs through config or the environment (#31)', () => {
  it.each([
    'git -c core.fsmonitor=/tmp/x status',
    'git -c core.sshCommand="ssh -i k" fetch',
    'git -c core.pager=less log',
    'git -c diff.x.textconv=evil diff',
    'git -c diff.x.command=evil diff',
    'git -c safe.directory=* status',
    'git --config-env=core.pager=PAGER log',
    'git --config-env core.editor=EDITOR commit',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=evil git log',
    "export GIT_CONFIG_PARAMETERS=\"'core.pager'='evil'\"",
    'GIT_EXTERNAL_DIFF=evil git diff',
    'GIT_SSH_COMMAND="ssh -i k" git fetch',
    'GIT_PAGER=less git log',
    'GIT_EDITOR=vim git commit',
    'env GIT_PAGER=evil git log',
    'export GIT_SSH_COMMAND=evil',
    'GIT_PAGER=evil make release',
    'git config core.pager less',
    'git config set core.fsmonitor /tmp/x',
    'git clone -c core.fsmonitor=evil /repo',
  ])('asks before %s', (command) => {
    expect(bashVerdict(command)).toEqual({
      decision: 'ask',
      reason: expect.stringMatching(RUNS_PROGRAM) as string,
    });
  });

  it.each([
    'git -c user.name=x -c user.email=y commit -m z',
    'git -c color.ui=always log',
    'git -c advice.detachedHead=false checkout v1',
    'git -c core.pager=cat log',
    'GIT_PAGER=cat git log',
    'GIT_PAGER= git log',
    'GIT_EDITOR=true git rebase --continue',
    'GIT_SEQUENCE_EDITOR=: git rebase -i HEAD~2',
    'git config user.email a@b.c',
    'git config --get core.pager',
    'git config --unset core.pager',
  ])('allows %s, whose key or program is on the safe list', (command) => {
    expect(bashDecision(command)).toBe('allow');
  });

  it.each([
    'git --exec-path=/tmp/x status',
    'git fetch --upload-pack=evil origin',
    'git ls-remote --upload-pack evil origin',
    'git push --receive-pack=evil origin',
    'git push --exec=evil origin',
    'git clone -u evil /repo',
  ])('asks before %s, which names the program git runs', (command) => {
    expect(bashVerdict(command).reason).toContain('runs a program its arguments name');
  });

  it('prints the exec path without asking', () => {
    expect(bashDecision('git --exec-path')).toBe('allow');
  });

  it('asks before git grep -O, which runs the program it names', () => {
    expect(bashVerdict('git grep -Oevil x').reason).toContain('git grep -O');
  });
});

describe('guard-bash on leased and plumbing force-pushes (#31)', () => {
  it.each([
    'git push --force-with-lease',
    'git push --force-with-lease origin',
    'git push --force-with-lease origin HEAD',
    'git push --force-with-lease origin @',
    'git push --force-if-includes --force-with-lease origin HEAD:HEAD',
    'git push --force-with-lease --all origin',
  ])('asks before %s, which may rewrite main when it is checked out', (command) => {
    expect(bashDecision(command)).toBe('ask');
  });

  it.each([
    'git push --force-with-lease origin main',
    'git push --force-with-lease origin HEAD:refs/heads/master',
    'git send-pack --force origin main',
    'git send-pack ../remote.git +feature',
  ])('denies %s', (command) => {
    expect(bashDecision(command)).toBe('deny');
  });

  it.each([
    'git push --force-with-lease origin feature',
    'git push --force-with-lease origin HEAD:feature',
    'git push origin',
    'git send-pack ../remote.git feature',
  ])('allows %s', (command) => {
    expect(bashDecision(command)).toBe('allow');
  });
});

describe('guard-bash publish rules', () => {
  it.each(['npm stage approve 1a2b', 'npm stage reject 1a2b', 'npm stage publish pkg.tgz'])(
    'asks before %s (#31)',
    (command) => {
      expect(bashDecision(command)).toBe('ask');
    },
  );

  it('allows listing staged publishes', () => {
    expect(bashDecision('npm stage list')).toBe('allow');
  });
});

describe('guard-bash on Windows home and project folders (#31)', () => {
  const windows = bashContext({}, { home: 'C:\\Users\\me', project: 'C:\\Users\\me\\proj' });

  it.each([
    'rm -rf /c/Users/me',
    "rm -rf 'C:\\Users\\me'",
    'rm -rf C:/Users/me/proj',
    'rm -rf ~/proj',
    'rm -rf /c',
    'rm -rf C:/',
    'rm -rf /c/Windows',
    'rm -rf /cygdrive/c/Users/me',
    'rm -rf /c/Users/someone',
  ])('denies %s', (command) => {
    expect(bashDecision(command, windows)).toBe('deny');
  });

  it.each(['rm -rf ~/proj/dist', 'rm -rf /c/Users/me/proj/node_modules', 'rm -rf C:/tmp/build'])(
    'allows %s',
    (command) => {
      expect(bashDecision(command, windows)).toBe('allow');
    },
  );
});

describe('guard-bash hook answers', () => {
  const project = (config?: string): string => {
    const dir = tempDir();
    if (config !== undefined) writeFiles(dir, { [`${BRAND.stateDir}/config.json`]: config });
    return dir;
  };
  const bash = (command: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    tool_name: 'Bash',
    tool_input: { command },
    ...extra,
  });

  it.each([{ x: 1 }, 42, undefined])('asks when the command is %j, not a string', (command) => {
    expect(hookAnswer(guardBash, bash(command), { projectDir: project() }).outcome).toBe('ask');
  });

  it('asks when stdin holds no JSON object, as the launch reports it', () => {
    const answer = guardBash.answer(
      { payload: {}, problem: 'stdin was not valid JSON' },
      { projectDir: project(), home: '/h' },
    );
    expect(answer).toMatchObject({ output: { hookSpecificOutput: { permissionDecision: 'ask' } } });
  });

  it('prefixes every reason with the guard label', () => {
    expect(hookAnswer(guardBash, bash('rm -rf /'), { projectDir: project() }).reason).toMatch(
      new RegExp(`^${BRAND.displayName} guard: `),
    );
  });

  it('reads its options from the project config', () => {
    const dir = project(JSON.stringify({ options: { safety: { blockNoVerify: true } } }));
    expect(hookAnswer(guardBash, bash('git commit -n -m x'), { projectDir: dir }).outcome).toBe('deny');
  });

  it.each([
    '{',
    '{"options":{"safety":{"blockNoVerify":"yes"}}}',
    '{"options":{"safety":{"denyCommands":"x"}}}',
  ])('asks, naming the config, when the options in %j cannot be used', (config) => {
    const { outcome, reason } = hookAnswer(guardBash, bash('ls'), { projectDir: project(config) });
    expect(outcome).toBe('ask');
    expect(reason).toContain(`${BRAND.stateDir}/config.json`);
  });

  it("finds a file named by git checkout in the session's working folder", () => {
    const dir = project();
    writeFiles(dir, { 'sub/notes.md': 'x' });
    const payload = bash('git checkout notes.md', { cwd: path.join(dir, 'sub') });
    expect(hookAnswer(guardBash, payload, { projectDir: dir }).outcome).toBe('ask');
    expect(hookAnswer(guardBash, bash('git checkout notes.md'), { projectDir: dir }).outcome).toBe('allow');
  });
});
