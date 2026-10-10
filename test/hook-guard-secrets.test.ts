import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { guardSecrets } from '../src/hooks/runtime/secrets/guard.js';
import { tempDir, writeFiles } from './helpers.js';
import { hookAnswer } from './hook-helpers.js';
import { LOOKALIKE_SAMPLES, SECRET_SAMPLES } from './secret-samples.js';

const PRAGMA = `${BRAND.markerPrefix}:allow-secret`;
const NEW_PRAGMA = /new line in .* marks a likely secret/;

/** guard-secrets' outcome and reason for a tool input, in a project at `projectDir`. */
function verdict(toolInput: unknown, projectDir = tempDir()): { outcome: string; reason: string } {
  return hookAnswer(guardSecrets, { tool_name: 'Write', tool_input: toolInput }, { projectDir });
}

const write = (content: string, file_path = 'src/config.ts'): Record<string, string> => ({
  file_path,
  content,
});

describe('guard-secrets patterns (#32)', () => {
  it.each(SECRET_SAMPLES)('denies a %s', (_name, secret) => {
    expect(verdict(write(`const value = '${secret}';`)).outcome).toBe('deny');
  });

  it.each(LOOKALIKE_SAMPLES)('allows a %s', (_name, text) => {
    expect(verdict(write(text)).outcome).toBe('allow');
  });

  it('names the rule and the file in its reason, never the value', () => {
    const secret = `ghp_${'s'.repeat(36)}`;
    const { outcome, reason } = verdict(write(`const token = '${secret}';`));
    expect(outcome).toBe('deny');
    expect(reason).toContain('possible GitHub token in the text written to src/config.ts');
    expect(reason).not.toContain(secret);
  });

  it('escapes control and bidirectional characters in the file name it shows', () => {
    const { reason } = verdict(write(`const token = 'ghp_${'s'.repeat(36)}';`, 'src/\u202Egnp.ts\u001b[2J'));
    expect(reason).toContain('src/\\u202egnp.ts\\u001b[2J');
    expect(reason.includes('\u202E') || reason.includes('\u001b')).toBe(false);
  });

  it.each([
    ['an edit', { file_path: 'a.ts', new_string: `token = 'ghp_${'a'.repeat(36)}'` }],
    [
      'a multi-edit',
      { file_path: 'k.pem', edits: [{ new_string: ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ') }] },
    ],
    ['a notebook cell', { notebook_path: 'n.ipynb', new_source: `key = "AKIA${'Q'.repeat(16)}"` }],
  ])('scans every string %s would write', (_name, toolInput) => {
    expect(verdict(toolInput).outcome).toBe('deny');
  });
});

describe('guard-secrets false positives (#32)', () => {
  it.each([
    ['a placeholder key', 'API_KEY=your-key-here'],
    ['a placeholder token', 'GITHUB_TOKEN=xxx'],
    ['a placeholder password', 'DATABASE_URL=postgres://app:changeme@localhost/app'],
    ['a prefix named in docs', 'GitHub tokens start with ghp_, Slack bot tokens with xoxb-.'],
    ['a regex for a key', '/\\bAKIA[0-9A-Z]{16}\\b/'],
    ['an integrity hash in a lockfile', '"integrity": "sha512-' + 'A'.repeat(86) + '=="'],
    ['a resolved URL in a lockfile', '"resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz"'],
    ['a fixture made at run time', "const token = `ghp_${'a'.repeat(36)}`;"],
    ['a variable reference', 'Authorization: Bearer ${API_TOKEN}'],
    ['a short sk- id', 'const id = "sk-123";'],
  ])('allows %s', (_name, content) => {
    expect(verdict(write(content, 'docs/notes.md')).outcome).toBe('allow');
  });
});

describe('guard-secrets env files and robustness', () => {
  it.each([
    '/p/.env',
    '/p/.env.local',
    '/p/.ENV',
    '/p/.envrc',
    '/p/packages/api/.env.production',
    '/p/.env~',
  ])('asks before editing %s', (file) => {
    expect(verdict({ file_path: file, content: 'A=1' })).toMatchObject({
      outcome: 'ask',
      reason: expect.stringContaining('holds secrets') as string,
    });
  });

  it.each(['/p/.env.example', '/p/.ENV.EXAMPLE', '/p/.env.sample', '/p/.env.template'])(
    'allows editing %s',
    (file) => {
      expect(verdict({ file_path: file, content: 'A=' }).outcome).toBe('allow');
    },
  );

  it('asks rather than crashing on a multi-edit whose edits it cannot replay', () => {
    const { outcome, reason } = verdict({ file_path: 'a.ts', edits: [null, { new_string: 'ok' }] });
    expect(outcome).toBe('ask');
    expect(reason).toContain('because an edit has no old_string or new_string');
  });

  it('allows a multi-edit payload whose edits are not a list', () => {
    expect(verdict({ file_path: 'a.ts', edits: 'not-an-array' }).outcome).toBe('allow');
  });

  it.each([{}, { content: 'x' }, { file_path: '', content: 'x' }, { file_path: 7, content: 'x' }])(
    'asks when the call names no file: %j',
    (toolInput) => {
      expect(verdict(toolInput).reason).toContain('the call names no file');
    },
  );

  it('asks when stdin held no JSON object', () => {
    const answer = guardSecrets.answer(
      { payload: {}, problem: 'stdin was not valid JSON' },
      { projectDir: tempDir(), home: '/h' },
    );
    expect(answer).toMatchObject({ output: { hookSpecificOutput: { permissionDecision: 'ask' } } });
  });
});

describe('guard-secrets allow pragma (ADR-0015)', () => {
  const fixtureLine = (token: string): string => `const fixture = 'ghp_${token.repeat(36)}'; // ${PRAGMA}`;

  /** guard-secrets on an edit of a project file that already holds `onDisk`. */
  function verdictIn(
    onDisk: string,
    toolInput: Record<string, unknown>,
  ): { outcome: string; reason: string } {
    const dir = tempDir();
    writeFiles(dir, { 'test/a.test.ts': onDisk });
    return verdict({ file_path: path.join(dir, 'test', 'a.test.ts'), ...toolInput }, dir);
  }

  it('asks before writing a new line that marks a secret with the pragma', () => {
    expect(verdictIn('', { content: fixtureLine('a') }).reason).toMatch(NEW_PRAGMA);
  });

  it('allows an edit that keeps a marked line already in the file', () => {
    const line = fixtureLine('a');
    expect(verdictIn(`${line}\r\n`, { old_string: line, new_string: `${line}\nexport {};` }).outcome).toBe(
      'allow',
    );
  });

  it('allows an edit elsewhere in a file that holds a marked line', () => {
    const toolInput = { old_string: 'const x = 1;', new_string: 'const x = 2;' };
    expect(verdictIn(`${fixtureLine('a')}\nconst x = 1;\n`, toolInput).outcome).toBe('allow');
  });

  it('asks when an edit replaces a marked line with one that marks another secret', () => {
    const toolInput = { old_string: fixtureLine('a'), new_string: fixtureLine('b') };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toMatch(NEW_PRAGMA);
  });

  it('asks when an edit changes only the token on a marked line', () => {
    const toolInput = { old_string: 'a'.repeat(36), new_string: 'b'.repeat(36) };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toMatch(NEW_PRAGMA);
  });

  it('asks when a multi-edit with replace_all changes the token on a marked line', () => {
    const onDisk = `const pad = '${'a'.repeat(36)}';\n${fixtureLine('a')}\n`;
    const edits = [{ old_string: 'a'.repeat(36), new_string: 'b'.repeat(36), replace_all: true }];
    expect(verdictIn(onDisk, { edits }).reason).toMatch(NEW_PRAGMA);
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
    expect(verdictIn(`${line}\n`, toolInput).outcome).toBe('deny');
  });

  it('allows a write that keeps a marked line already in the file', () => {
    const line = fixtureLine('a');
    expect(verdictIn(`${line}\r\nconst x = 1;\r\n`, { content: `${line}\nconst x = 2;\n` }).outcome).toBe(
      'allow',
    );
  });

  it('asks on a notebook edit even when the cell already holds the marked line', () => {
    const dir = tempDir();
    const notebook = { cells: [{ cell_type: 'code', source: [fixtureLine('a')] }] };
    writeFiles(dir, { 'n.ipynb': JSON.stringify(notebook, null, 1) });
    const toolInput = { notebook_path: path.join(dir, 'n.ipynb'), new_source: fixtureLine('a') };
    expect(verdict(toolInput, dir).reason).toMatch(NEW_PRAGMA);
  });

  it('asks when replace_all is not a boolean, because the replay could differ from the edit', () => {
    const toolInput = { old_string: 'a'.repeat(36), new_string: 'b'.repeat(36), replace_all: 'true' };
    expect(verdictIn(`${fixtureLine('a')}\n`, toolInput).reason).toContain(
      'because replace_all is not true or false',
    );
  });

  it('allows a pragma mention that marks no secret', () => {
    expect(verdictIn('', { content: `Use ${PRAGMA} only in tests.` }).outcome).toBe('allow');
  });

  it('does not trust a marked line in a file over the size cap', () => {
    const line = fixtureLine('a');
    const { reason } = verdictIn(`${line}\n${'x'.repeat(1_000_001)}\n`, { content: line });
    expect(reason).toContain('could not check the marked line in test/a.test.ts because it is over 1 MB');
  });

  it('names the size cap when it asks about an edit to a large file', () => {
    expect(verdictIn('x'.repeat(1_000_001), { old_string: 'x', new_string: 'y' }).reason).toContain(
      'because it is over 1 MB',
    );
  });

  it('asks about an edit that would grow a file past the size cap', () => {
    const toolInput = { old_string: 'x', new_string: 'y'.repeat(20) };
    expect(verdictIn('x'.repeat(999_990), toolInput).reason).toContain('the edited file would be over 1 MB');
  });

  it.skipIf(process.platform === 'win32')('refuses to read a FIFO target and asks', () => {
    const dir = tempDir();
    const fifo = path.join(dir, 'f.ts');
    execFileSync('mkfifo', [fifo]);
    expect(verdict({ file_path: fifo, old_string: 'a', new_string: 'b' }, dir).reason).toContain(
      'because it is not a regular file',
    );
  });
});
