import { copyFileSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import {
  REPO_ROOT,
  canSymlink,
  hookDecision,
  hookVerdict,
  permissionDecision,
  tempDir,
  writeFiles,
} from './helpers.js';

const decision = (toolInput: unknown) => hookDecision('guard-secrets.mjs', toolInput);

const write = (content: string) => ({ file_path: 'src/config.ts', content });

describe('guard-secrets patterns', () => {
  it.each([
    ['AWS temporary key', `ASIA${'Q'.repeat(16)}`],
    ['AWS secret line', `aws_secret_access_key = ${'a'.repeat(40)}`],
    ['GitHub token followed by an underscore', `ghp_${'a'.repeat(36)}_x`],
    ['Slack app token', `xapp-1-${'A'.repeat(20)}`],
    [
      'Slack webhook',
      `https://hooks.slack.com/services/${'T'.repeat(9)}/${'B'.repeat(11)}/${'x'.repeat(24)}`,
    ],
    ['Stripe webhook secret', `whsec_${'a'.repeat(32)}`],
    ['PGP private key block', ['-----BEGIN PGP PRIVATE', 'KEY BLOCK-----'].join(' ')],
    ['JWT', `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`],
    ['credentialed database URL', 'postgres://admin:s3cr3tValue@db.internal:5432/app'],
    ['npmrc auth token', `//registry.npmjs.org/:_authToken=${'n'.repeat(36)}`],
  ])('denies a %s', (_name, secret) => {
    expect(decision(write(`const value = '${secret}';`))).toBe('deny');
  });

  it.each([
    ['env-var reference in a URL', 'https://user:${TOKEN}@github.com/o/r.git'],
    ['placeholder password', 'postgres://user:password@localhost/db'],
    ['npmrc token from env', '//registry.npmjs.org/:_authToken=${NPM_TOKEN}'],
  ])('allows a %s', (_name, text) => {
    expect(decision(write(text))).toBe('allow');
  });
});

describe('guard-secrets env files and robustness', () => {
  it.each(['/p/.ENV', '/p/.envrc', '/p/packages/api/.env.production'])('asks before editing %s', (file) => {
    expect(decision({ file_path: file, content: 'A=1' })).toBe('ask');
  });

  it('allows editing .env.example in any case', () => {
    expect(decision({ file_path: '/p/.ENV.EXAMPLE', content: 'A=' })).toBe('allow');
  });

  it('asks rather than crashing on a multi-edit whose edits it cannot replay', () => {
    const verdict = hookVerdict('guard-secrets.mjs', {
      file_path: 'a.ts',
      edits: [null, { new_string: 'ok' }],
    });
    expect(verdict.decision).toBe('ask');
    expect(verdict.reason).toContain('because an edit has no old_string or new_string');
  });

  it('allows a multi-edit payload whose edits are not a list', () => {
    expect(decision({ file_path: 'a.ts', edits: 'not-an-array' })).toBe('allow');
  });
});

describe('guard-secrets fail-closed loading', () => {
  it('asks instead of allowing when its helper module cannot be loaded', () => {
    const isolated = path.join(tempDir(), 'guard-secrets.mjs');
    copyFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'guard-secrets.mjs'), isolated);
    const run = spawnSync(process.execPath, [isolated], {
      input: JSON.stringify({ tool_input: { file_path: 'a.ts', content: 'x' } }),
      encoding: 'utf8',
    });
    expect(permissionDecision(run.stdout)).toBe('ask');
  });

  it.each(['/p/.env~', '/p/.env.backup'])('asks before editing %s', (file) => {
    expect(decision({ file_path: file, content: 'A=1' })).toBe('ask');
  });
});

describe('guard-secrets allow pragma', () => {
  const pragma = `${BRAND.markerPrefix}:allow-secret`;
  const fixtureLine = (token: string) => `const fixture = 'ghp_${token.repeat(36)}'; // ${pragma}`;

  const askedForPragma = /new line marks a likely secret/;

  /** Runs the guard against a file that already holds `onDisk`, in a temp project. */
  const verdictIn = (onDisk: string, toolInput: Record<string, unknown>) => {
    const dir = tempDir();
    writeFiles(dir, { 'test/a.test.ts': onDisk });
    const file_path = path.join(dir, 'test', 'a.test.ts');
    return hookVerdict('guard-secrets.mjs', { file_path, ...toolInput }, { CLAUDE_PROJECT_DIR: dir });
  };
  const decideIn = (onDisk: string, toolInput: Record<string, unknown>) =>
    verdictIn(onDisk, toolInput).decision;

  it('asks before writing a new line that marks a secret with the pragma', () => {
    expect(decideIn('', { content: fixtureLine('a') })).toBe('ask');
  });

  it('allows an edit that keeps a marked line already in the file', () => {
    const line = fixtureLine('a');
    expect(decideIn(`${line}\r\n`, { old_string: line, new_string: `${line}\nexport {};` })).toBe('allow');
  });

  it('allows an edit elsewhere in a file that holds a marked line', () => {
    const toolInput = { old_string: 'const x = 1;', new_string: 'const x = 2;' };
    expect(decideIn(`${fixtureLine('a')}\nconst x = 1;\n`, toolInput)).toBe('allow');
  });

  it('asks when an edit replaces a marked line with one that marks another secret', () => {
    const toolInput = { old_string: fixtureLine('a'), new_string: fixtureLine('b') };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toMatch(askedForPragma);
  });

  it('asks when an edit changes only the token on a marked line', () => {
    const toolInput = { old_string: 'a'.repeat(36), new_string: 'b'.repeat(36) };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toMatch(askedForPragma);
  });

  it('asks when a multi-edit with replace_all changes the token on a marked line', () => {
    const onDisk = `const pad = '${'a'.repeat(36)}';\n${fixtureLine('a')}\n`;
    const edits = [{ old_string: 'a'.repeat(36), new_string: 'b'.repeat(36), replace_all: true }];
    expect(verdictIn(onDisk, { edits }).reason).toMatch(askedForPragma);
  });

  it('asks when an edit completes a secret from text already on the line', () => {
    const toolInput = { old_string: "' + suffix", new_string: `${'d'.repeat(36)}'` };
    expect(verdictIn("const token = 'ghp_' + suffix;\n", toolInput).reason).toContain(
      'possible GitHub token',
    );
  });

  it('asks when the old_string of an edit is not in the file', () => {
    const toolInput = { old_string: 'not there', new_string: 'x' };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toContain(
      'because an old_string is not in the file',
    );
  });

  it('still denies an unmarked secret next to a marked line already in the file', () => {
    const line = fixtureLine('a');
    const toolInput = { old_string: line, new_string: `${line}\nconst live = 'ghp_${'c'.repeat(36)}';` };
    expect(decideIn(`${line}\n`, toolInput)).toBe('deny');
  });

  it('allows a write that keeps a marked line already in the file', () => {
    const line = fixtureLine('a');
    expect(decideIn(`${line}\r\nconst x = 1;\r\n`, { content: `${line}\nconst x = 2;\n` })).toBe('allow');
  });

  it('asks on a notebook edit even when the cell already holds the marked line', () => {
    const dir = tempDir();
    const notebook = { cells: [{ cell_type: 'code', source: [fixtureLine('a')] }] };
    writeFiles(dir, { 'n.ipynb': JSON.stringify(notebook, null, 1) });
    const toolInput = { notebook_path: path.join(dir, 'n.ipynb'), new_source: fixtureLine('a') };
    const verdict = hookVerdict('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: dir });
    expect(verdict.reason).toMatch(askedForPragma);
  });

  it('asks when replace_all is not a boolean, because the replay could differ from the edit', () => {
    const toolInput = { old_string: 'a'.repeat(36), new_string: 'b'.repeat(36), replace_all: 'true' };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toContain(
      'because replace_all is not true or false',
    );
  });

  it('allows a pragma mention that marks no secret', () => {
    expect(decideIn('', { content: `Use ${pragma} only in tests.` })).toBe('allow');
  });

  it.skipIf(!canSymlink())('does not trust a marked line behind a symlink to a file outside', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFiles(outside, { 'real.ts': `${fixtureLine('a')}\n` });
    symlinkSync(path.join(outside, 'real.ts'), path.join(dir, 'link.ts'));
    const line = fixtureLine('a');
    const toolInput = { file_path: path.join(dir, 'link.ts'), old_string: line, new_string: line };
    expect(hookDecision('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: dir })).toBe('ask');
  });

  it('does not trust a marked line in a file over the size cap', () => {
    const line = fixtureLine('a');
    const verdict = verdictIn(`${line}\n${'x'.repeat(1_000_001)}\n`, { content: line });
    expect(verdict.reason).toContain('could not check the marked line because it is over 1 MB');
  });

  it('names the size cap when it asks about an edit to a large file', () => {
    const toolInput = { old_string: 'x', new_string: 'y' };
    expect(verdictIn('x'.repeat(1_000_001), toolInput).reason).toContain('because it is over 1 MB');
  });

  it('asks about an edit that would grow a file past the size cap', () => {
    const toolInput = { old_string: 'x', new_string: 'y'.repeat(20) };
    expect(verdictIn('x'.repeat(999_990), toolInput).reason).toContain('the edited file would be over 1 MB');
  });

  it('does not trust a marked line in a file outside the project', () => {
    const outside = tempDir();
    writeFiles(outside, { 'a.test.ts': `${fixtureLine('a')}\n` });
    const toolInput = { file_path: path.join(outside, 'a.test.ts'), content: fixtureLine('a') };
    expect(hookDecision('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: tempDir() })).toBe('ask');
  });

  it.skipIf(process.platform === 'win32')('refuses to read a FIFO target and asks', () => {
    const dir = tempDir();
    const fifo = path.join(dir, 'f.ts');
    execFileSync('mkfifo', [fifo]);
    const toolInput = { file_path: fifo, old_string: 'a', new_string: 'b' };
    const verdict = hookVerdict('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: dir });
    expect(verdict.reason).toContain('because it is not a regular file');
  });
});

describe('guard-secrets edit targets', () => {
  const harmlessEdit = { old_string: 'x = 1', new_string: 'x = 2' };

  it('allows a harmless edit to a file outside the project', () => {
    const outside = tempDir();
    writeFiles(outside, { 'memory/notes.md': 'x = 1\n' });
    const toolInput = { file_path: path.join(outside, 'memory', 'notes.md'), ...harmlessEdit };
    expect(hookDecision('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: tempDir() })).toBe('allow');
  });

  it('still denies a secret written into a file outside the project', () => {
    const outside = tempDir();
    writeFiles(outside, { 'a.ts': 'x = 1\n' });
    const toolInput = {
      file_path: path.join(outside, 'a.ts'),
      old_string: 'x = 1',
      new_string: `x = 'ghp_${'e'.repeat(36)}'`,
    };
    expect(hookDecision('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: tempDir() })).toBe('deny');
  });

  /** Makes a project whose CLAUDE.md is a symlink to an AGENTS.md holding `content`. */
  const linkedClaudeMd = (content: string) => {
    const dir = tempDir();
    writeFiles(dir, { 'AGENTS.md': content });
    symlinkSync(path.join(dir, 'AGENTS.md'), path.join(dir, 'CLAUDE.md'));
    return { file_path: path.join(dir, 'CLAUDE.md'), env: { CLAUDE_PROJECT_DIR: dir } };
  };

  it.skipIf(!canSymlink())('allows a harmless edit through a symlink to a project file', () => {
    const { file_path, env } = linkedClaudeMd('x = 1\n');
    expect(hookDecision('guard-secrets.mjs', { file_path, ...harmlessEdit }, env)).toBe('allow');
  });

  it.skipIf(!canSymlink())('asks when an edit through a symlink completes a token', () => {
    const { file_path, env } = linkedClaudeMd("const token = 'ghp_' + suffix;\n");
    const completes = { file_path, old_string: "' + suffix", new_string: `${'d'.repeat(36)}'` };
    expect(hookVerdict('guard-secrets.mjs', completes, env).reason).toContain('possible GitHub token');
  });
});

describe('guard-secrets scan cost', () => {
  const budgetMs = 3_000;

  it('scans close to 1 MB of adversarial text well within the hook timeout', () => {
    const lines = ['eyJ-', 'a-', 'a.', 'a://b:', 'eyJa.'].map((unit) => unit.repeat(150_000 / unit.length));
    const started = performance.now();
    expect(decision(write(lines.join('\n')))).toBe('allow');
    expect(performance.now() - started).toBeLessThan(budgetMs);
  });

  it('asks about an edit that completes a token at the end of a long line, in time', () => {
    const dir = tempDir();
    writeFiles(dir, { 'src/a.ts': `const k = '${'a.'.repeat(150_000)}ghp_${'f'.repeat(35)}Z';\n` });
    const toolInput = { file_path: path.join(dir, 'src', 'a.ts'), old_string: "Z'", new_string: "ff'" };
    const started = performance.now();
    const verdict = hookVerdict('guard-secrets.mjs', toolInput, { CLAUDE_PROJECT_DIR: dir });
    expect(performance.now() - started).toBeLessThan(budgetMs);
    expect(verdict.reason).toContain('possible GitHub token');
  });

  it('asks rather than scanning written text over 1 MB', () => {
    expect(decision(write('x'.repeat(1_000_001)))).toBe('ask');
  });
});
