import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../src/core/unified-diff.js';
import { git, tempDir, writeFiles } from './helpers.js';

const HUNK = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

interface Hunk {
  readonly start: number;
  readonly body: { kind: string; chunk: string }[];
}

/** A text as its lines, each with its newline, the last one without when the text has none at the end. */
function chunks(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function hunksOf(diff: string): Hunk[] {
  const lines = diff.split('\n').slice(2, -1);
  const hunks: Hunk[] = [];
  for (const [index, line] of lines.entries()) {
    const header = HUNK.exec(line);
    if (header !== null) hunks.push({ start: Number(header[1]) - (header[2] === '0' ? 0 : 1), body: [] });
    else if (!line.startsWith('\\')) {
      const newline = lines[index + 1]?.startsWith('\\') === true ? '' : '\n';
      hunks.at(-1)?.body.push({ kind: line.charAt(0), chunk: `${line.slice(1)}${newline}` });
    }
  }
  return hunks;
}

/** Applies a diff the way patch would, checking every context and removed line against `before`. */
function applyDiff(before: string, diff: string): string {
  const old = chunks(before);
  const result: string[] = [];
  let cursor = 0;
  for (const { start, body } of hunksOf(diff)) {
    result.push(...old.slice(cursor, start));
    cursor = start;
    for (const { kind, chunk } of body) {
      if (kind !== '+') expect(old[cursor++]).toBe(chunk);
      if (kind !== '-') result.push(chunk);
    }
  }
  return [...result, ...old.slice(cursor)].join('');
}

describe('unifiedDiff', () => {
  it('prints nothing when the texts are equal, line endings aside', () => {
    expect(unifiedDiff('a.md', 'x\ny\n', 'x\ny\n')).toBe('');
    expect(unifiedDiff('a.md', 'x\r\ny\r\n', 'x\ny\n')).toBe('');
  });

  it('shows a new file against /dev/null', () => {
    expect(unifiedDiff('CLAUDE.md', undefined, '@AGENTS.md\n')).toBe(
      '--- /dev/null\n+++ b/CLAUDE.md\n@@ -0,0 +1,1 @@\n+@AGENTS.md\n',
    );
  });

  it('shows a deleted file against /dev/null', () => {
    expect(unifiedDiff('old.md', 'gone\n', undefined)).toBe(
      '--- a/old.md\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n',
    );
  });

  it('keeps three lines of context around a change', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', ''].join('\n');
    const after = ['1', '2', '3', '4', 'five', '6', '7', '8', ''].join('\n');
    expect(unifiedDiff('n.txt', before, after)).toBe(
      '--- a/n.txt\n+++ b/n.txt\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n',
    );
  });

  it.each([
    ['3 and 10', ['3', '10'], ['@@ -1,13 +1,13 @@']],
    ['3 and 11', ['3', '11'], ['@@ -1,6 +1,6 @@', '@@ -8,7 +8,7 @@']],
  ])('groups changes to lines %s into hunks as diff -u does', (_name, changed, headers) => {
    const lines = Array.from({ length: 20 }, (_, index) => String(index + 1));
    const after = lines.map((line) => (changed.includes(line) ? `${line}!` : line));
    const diff = unifiedDiff('n.txt', `${lines.join('\n')}\n`, `${after.join('\n')}\n`);
    expect(diff.match(/^@@.*$/gm)).toEqual(headers);
  });

  it('marks a last line without a newline', () => {
    expect(unifiedDiff('a.txt', 'a\nb', 'a\nb\n')).toBe(
      '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n',
    );
  });

  it('shows a huge rewrite as one change without building the whole table', () => {
    const before = `${Array.from({ length: 3000 }, (_, index) => `old ${String(index)}`).join('\n')}\n`;
    const after = `${Array.from({ length: 3000 }, (_, index) => `new ${String(index)}`).join('\n')}\n`;
    const diff = unifiedDiff('big.txt', before, after);
    expect(diff.split('\n')[2]).toBe('@@ -1,3000 +1,3000 @@');
    expect(applyDiff(before, diff)).toBe(after);
  });

  it('gives a diff that turns the old text into the new one', () => {
    const line = fc.constantFrom('a', 'b', 'c', 'd', '');
    const text = fc
      .tuple(fc.array(line, { maxLength: 30 }), fc.boolean())
      .map(([lines, newline]) => (lines.length === 0 ? '' : `${lines.join('\n')}${newline ? '\n' : ''}`));
    fc.assert(
      fc.property(text, text, (before, after) => {
        const diff = unifiedDiff('f.txt', before, after);
        expect(diff === '' ? before : applyDiff(before, diff)).toBe(after);
      }),
      { numRuns: 500 },
    );
  });

  it('gives a diff git apply accepts and that turns the old file into the new one', () => {
    const line = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '');
    const text = fc
      .tuple(fc.array(line, { minLength: 1, maxLength: 24 }), fc.boolean())
      .map(([lines, newline]) => `${lines.join('\n')}${newline ? '\n' : ''}`);
    fc.assert(
      fc.property(text, text, (before, after) => {
        const diff = unifiedDiff('f.txt', before, after);
        if (diff === '') return;
        const dir = tempDir();
        writeFiles(dir, { 'f.txt': before, 'f.patch': diff });
        git(dir, 'apply', '--whitespace=nowarn', 'f.patch');
        expect(readFileSync(path.join(dir, 'f.txt'), 'utf8')).toBe(after);
      }),
      { numRuns: 40 },
    );
  });
});
