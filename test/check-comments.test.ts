import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir } from './helpers.js';

function check(source: string, extension = '.ts'): { status: number | null; stderr: string } {
  const file = path.join(tempDir(), `sample${extension}`);
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

  it.each([
    '// for Windows (cmd.exe) we must pass shell: true',
    '// if the file exists (e.g. on reruns) skip it',
    '// return early: callers expect undefined = "not found"',
    '// Claude Code sends a payload shaped like { tool_input }',
  ])('accepts prose that merely contains code punctuation: %s', (comment) => {
    expect(check(`${comment}\nexport const a = 1;\n`).status).toBe(0);
  });

  it('accepts a deeply indented multi-line block comment', () => {
    const source =
      'export function f(): number {\n    /*\n     * Why this is safe.\n     */\n  return 1;\n}\n';
    expect(check(source).status).toBe(0);
  });

  it.each(['// const b = 2;', '// doThing(a);', '// total = a + b;'])(
    'rejects commented-out code: %s',
    (line) => {
      const result = check(`export const a = 1;\n${line}\n`);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('commented-out code');
    },
  );

  it('treats a /** block inside a function body as a normal comment', () => {
    const source = 'export function g(): void {\n  /** const old = legacy(); */\n}\n';
    expect(check(source).stderr).toContain('commented-out code');
  });

  it('rejects TODOs without an issue reference, in any case', () => {
    expect(check('// TODO: tidy this\nexport const a = 1;\n').stderr).toContain('must reference an issue');
    expect(check('// fixme later\nexport const a = 1;\n').stderr).toContain('must reference an issue');
    expect(check('// TODO(#12): tidy this\nexport const a = 1;\n').status).toBe(0);
  });

  it.each(['// ----------------', '/****************/'])('rejects decorative dividers: %s', (divider) => {
    expect(check(`${divider}\nexport const a = 1;\n`).stderr).toContain('decorative divider');
  });

  it('rejects files where comments outweigh the policy ratio', () => {
    const chatter = Array.from({ length: 6 }, (_, i) => `// Note ${String(i)} about the values.`).join('\n');
    const result = check(`${chatter}\n${codeLines(20)}\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('comment lines');
  });

  it('ignores directives, strings, regex literals and JSX text', () => {
    const source = [
      '// eslint-disable-next-line no-console -- CLI output',
      "console.log('// not a comment');",
      'export const url = /https?:\\/\\//;',
      'export const Link = () => <a href="x">// docs link</a>;',
    ].join('\n');
    expect(check(source, '.tsx').status).toBe(0);
  });

  it('checks plain JavaScript modules too', () => {
    expect(check('export const a = 1;\n// return a;\n', '.mjs').status).toBe(1);
  });
});
