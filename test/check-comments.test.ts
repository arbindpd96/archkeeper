import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript } from './helpers.js';

function check(source: string, extension = '.ts'): { status: number | null; stderr: string } {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'codekit-comments-')), `sample${extension}`);
  writeFileSync(file, source);
  return runScript('scripts/check-comments.mjs', { args: [file] });
}

const codeLines = (count: number): string =>
  Array.from({ length: count }, (_, i) => `export const value${String(i)} = ${String(i)};`).join('\n');

describe('check-comments', () => {
  it('accepts JSDoc summaries and why-comments', () => {
    const source = [
      '/** Adds two numbers. */',
      'export function add(a: number, b: number): number {',
      '  // Floats are rounded upstream, so plain addition is exact here.',
      '  return a + b;',
      '}',
    ].join('\n');
    expect(check(source).status).toBe(0);
  });

  it('rejects commented-out code', () => {
    const result = check('export const a = 1;\n// const b = 2;\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('commented-out code');
  });

  it('rejects TODOs without an issue reference', () => {
    expect(check('// TODO: tidy this\nexport const a = 1;\n').stderr).toContain('must reference an issue');
    expect(check('// TODO(#12): tidy this\nexport const a = 1;\n').status).toBe(0);
  });

  it('rejects decorative dividers', () => {
    expect(check('// ----------------\nexport const a = 1;\n').stderr).toContain('decorative divider');
  });

  it('rejects files where comments outweigh the policy ratio', () => {
    const chatter = Array.from({ length: 6 }, (_, i) => `// Note ${String(i)} about the values below.`).join(
      '\n',
    );
    const result = check(`${chatter}\n${codeLines(20)}\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('comment lines');
  });

  it('ignores tool directives and comment-like text inside regex and strings', () => {
    const source = [
      '// eslint-disable-next-line no-console -- CLI output',
      "console.log('// not a comment');",
      'export const url = /https?:\\/\\//;',
    ].join('\n');
    expect(check(source).status).toBe(0);
  });

  it('checks plain JavaScript modules too', () => {
    expect(check('export const a = 1;\n// return a;\n', '.mjs').status).toBe(1);
  });
});
