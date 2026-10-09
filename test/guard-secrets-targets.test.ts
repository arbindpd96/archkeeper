import { existsSync, linkSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import {
  canSymlink,
  hookDecision,
  hookVerdict,
  permissionDecision,
  runScript,
  tempDir,
  writeFiles,
} from './helpers.js';

const harmlessEdit = { old_string: 'x = 1', new_string: 'x = 2' };
const tokenStart = "const token = 'ghp_' + suffix;\n";
const completesToken = { old_string: "' + suffix", new_string: `${'d'.repeat(36)}'` };
const tokenReason = 'possible GitHub token';

/** Runs guard-secrets on an edit of `file_path` in a project at `projectDir`. */
const verdictFor = (file_path: string, edit: Record<string, unknown>, projectDir = tempDir()) =>
  hookVerdict('guard-secrets.mjs', { file_path, ...edit }, { CLAUDE_PROJECT_DIR: projectDir });

describe('guard-secrets on files outside the project', () => {
  it('allows a harmless edit to a file outside the project', () => {
    const outside = tempDir();
    writeFiles(outside, { 'memory/notes.md': 'x = 1\n' });
    expect(verdictFor(path.join(outside, 'memory', 'notes.md'), harmlessEdit).decision).toBe('allow');
  });

  it('denies a secret written into a file outside the project', () => {
    const outside = tempDir();
    writeFiles(outside, { 'a.ts': 'x = 1\n' });
    const edit = { old_string: 'x = 1', new_string: `x = 'ghp_${'e'.repeat(36)}'` };
    expect(verdictFor(path.join(outside, 'a.ts'), edit).decision).toBe('deny');
  });

  it('replays an edit on a file outside the project and asks when it completes a token', () => {
    const outside = tempDir();
    writeFiles(outside, { 'a.ts': tokenStart });
    expect(verdictFor(path.join(outside, 'a.ts'), completesToken).reason).toContain(tokenReason);
  });

  it('trusts a marked line already in a file outside the project, as in any other file', () => {
    const line = `const fixture = 'ghp_${'a'.repeat(36)}'; // ${BRAND.markerPrefix}:allow-secret`;
    const outside = tempDir();
    writeFiles(outside, { 'a.test.ts': `${line}\n` });
    expect(verdictFor(path.join(outside, 'a.test.ts'), { content: line }).decision).toBe('allow');
  });

  it('asks when an edit through a hardlink outside the project completes a token in a project file', () => {
    const dir = tempDir();
    writeFiles(dir, { 'src/a.ts': tokenStart });
    const link = path.join(tempDir(), 'a.ts');
    linkSync(path.join(dir, 'src', 'a.ts'), link);
    expect(verdictFor(link, completesToken, dir).reason).toContain(tokenReason);
  });

  it('asks when an edit through a case-variant path completes a token', (context) => {
    const root = tempDir();
    writeFiles(root, { 'Proj/src/a.ts': tokenStart });
    const variant = path.join(root, 'proj', 'src', 'a.ts');
    if (!existsSync(variant)) context.skip();
    expect(verdictFor(variant, completesToken, path.join(root, 'Proj')).reason).toContain(tokenReason);
  });
});

describe.skipIf(!canSymlink())('guard-secrets through symlinks', () => {
  /** Makes a project whose CLAUDE.md is a symlink to an AGENTS.md holding `content`. */
  const linkedClaudeMd = (content: string) => {
    const dir = tempDir();
    writeFiles(dir, { 'AGENTS.md': content });
    symlinkSync(path.join(dir, 'AGENTS.md'), path.join(dir, 'CLAUDE.md'));
    return { file: path.join(dir, 'CLAUDE.md'), dir };
  };

  it('allows a harmless edit through a symlink to a project file', () => {
    const { file, dir } = linkedClaudeMd('x = 1\n');
    expect(verdictFor(file, harmlessEdit, dir).decision).toBe('allow');
  });

  it('asks when an edit through a symlink completes a token', () => {
    const { file, dir } = linkedClaudeMd(tokenStart);
    expect(verdictFor(file, completesToken, dir).reason).toContain(tokenReason);
  });

  it('replays an edit through a symlink to a file outside the project', () => {
    const dir = tempDir();
    const outside = tempDir();
    writeFiles(outside, { 'real.ts': tokenStart });
    symlinkSync(path.join(outside, 'real.ts'), path.join(dir, 'link.ts'));
    expect(verdictFor(path.join(dir, 'link.ts'), completesToken, dir).reason).toContain(tokenReason);
  });

  it('asks before editing a file whose real name is .env', () => {
    const dir = tempDir();
    writeFiles(dir, { '.env': 'KEY=placeholder\n' });
    symlinkSync(path.join(dir, '.env'), path.join(dir, 'notes.txt'));
    const edit = { old_string: 'placeholder', new_string: 'prod-value' };
    expect(verdictFor(path.join(dir, 'notes.txt'), edit, dir).reason).toContain('.env holds secrets');
  });
});

describe('guard-secrets edit replay', () => {
  it("resolves a relative file_path against the session's working directory", () => {
    const dir = tempDir();
    writeFiles(dir, { 'sub/a.ts': 'x = 1\n' });
    const run = runScript('.claude/hooks/guard-secrets.mjs', {
      payload: { cwd: path.join(dir, 'sub'), tool_input: { file_path: 'a.ts', ...harmlessEdit } },
      env: { CLAUDE_PROJECT_DIR: dir },
    });
    expect(permissionDecision(run.stdout)).toBe('allow');
  });

  it('asks when a multi-edit has too many edits to replay on a file its size', () => {
    const dir = tempDir();
    writeFiles(dir, { 'big.txt': 'x'.repeat(999_000) });
    const edits = Array.from({ length: 60 }, () => ({ old_string: 'x', new_string: 'x' }));
    const verdict = verdictFor(path.join(dir, 'big.txt'), { edits }, dir);
    expect(verdict.reason).toContain('too many to replay in time');
  });

  it('counts replay work as a multi-edit grows a small file, and asks in time', () => {
    const dir = tempDir();
    writeFiles(dir, { 'a.ts': 'a' });
    const grow = { old_string: 'a', new_string: `a${'b'.repeat(500_000)}` };
    const rescan = { old_string: 'b', new_string: 'b', replace_all: true };
    const rescans = Array.from({ length: 2_000 }, () => rescan);
    const started = performance.now();
    const verdict = verdictFor(path.join(dir, 'a.ts'), { edits: [grow, ...rescans] }, dir);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(verdict.reason).toContain('too many to replay in time');
  });

  it('asks rather than reading a file that is not a regular file', () => {
    expect(verdictFor(tempDir(), harmlessEdit).reason).toContain('because it is not a regular file');
  });
});

describe('guard-secrets scan cost', () => {
  const budgetMs = 3_000;

  it('scans close to 1 MB of adversarial text well within the hook timeout', () => {
    const lines = ['eyJ-', 'a-', 'a.', 'a://b:', 'eyJa.'].map((unit) => unit.repeat(150_000 / unit.length));
    const started = performance.now();
    expect(hookDecision('guard-secrets.mjs', { file_path: 'src/a.ts', content: lines.join('\n') })).toBe(
      'allow',
    );
    expect(performance.now() - started).toBeLessThan(budgetMs);
  });

  it('asks about an edit that completes a token at the end of a long line, in time', () => {
    const dir = tempDir();
    writeFiles(dir, { 'src/a.ts': `const k = '${'a.'.repeat(150_000)}ghp_${'f'.repeat(35)}Z';\n` });
    const started = performance.now();
    const verdict = verdictFor(path.join(dir, 'src', 'a.ts'), { old_string: "Z'", new_string: "ff'" }, dir);
    expect(performance.now() - started).toBeLessThan(budgetMs);
    expect(verdict.reason).toContain(tokenReason);
  });

  it('asks rather than scanning written text over 1 MB', () => {
    expect(hookDecision('guard-secrets.mjs', { file_path: 'a.ts', content: 'x'.repeat(1_000_001) })).toBe(
      'ask',
    );
  });
});
