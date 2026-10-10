import { describe, expect, it } from 'vitest';
import { importsOf } from '../scripts/context-rules.mjs';
import { withoutImportedBlocks } from '../src/core/import-blocks.js';
import type { RenderTree } from '../src/core/render.js';
import { blockEntry, TEST_BRAND } from './kit-fixtures.js';

// The kit's reader and the context budget's each port Claude Code 2.1.295's extractor on marked 15.0.6 without
// GFM, the budget's as a script (docs/decisions.md says why it may import marked); one table keeps them equal.
// Each row says what Claude Code imports, checked by running the extractor and marked copied out of its binary.
// The rows after the first are the security review's texts that the budget's old reader under-counted.
const CASES: readonly (readonly [text: string, imports: boolean])[] = [
  ['@AGENTS.md', true],
  ['- a\n\n    @AGENTS.md', true],
  ['<a "x">\n@AGENTS.md', true],
  ['[@AGENTS.md](x "t")', true],
  ['<a@b.c>@AGENTS.md', true],
  ['*@AGENTS.md**', true],
  ['Shared rules: @AGENTS.md.', false],
  ['See @AGENTS.md, then code.', false],
  ['Did you read @AGENTS.md?', false],
  ['See @AGENTS.md: rules', false],
  ['@AGENTS.md*', false],
  ['**@AGENTS.md**', true],
  ['_@AGENTS.md_', true],
  ['(@AGENTS.md)', false],
  ['The shared rules (@AGENTS.md) apply.', false],
  ['[@AGENTS.md], then more', false],
  ['[@AGENTS.md](AGENTS.md)', true],
  ['[rules](@AGENTS.md)', false],
  ['rules-@AGENTS.md', false],
  ['see/@AGENTS.md', false],
  ['\\@AGENTS.md', false],
  ['~~@AGENTS.md~~', false],
  ['Read @AGENTS.md#principles first.', true],
  ['@AGENTS.md\\ ', true],
  ['run `npm test`@AGENTS.md', true],
  ['run`npm test`@AGENTS.md', true],
  ['mail docs@AGENTS.md', false],
  ['@@AGENTS.md', false],
  ['`@AGENTS.md`', false],
  ['``@AGENTS.md``', false],
  ['see ` @AGENTS.md ` here', false],
  ['```\n@AGENTS.md\n```', false],
  ['   ~~~md\n@AGENTS.md\n   ~~~', false],
  ['```\ncode\n```\n@AGENTS.md', true],
  ['````\n```\n@AGENTS.md\n```\n````', false],
  ['~~~\n```\n@AGENTS.md\n~~~', false],
  ['```\n@AGENTS.md\n``', false],
  ['# Notes\n\nTo import a file, write:\n\n    @AGENTS.md', false],
  ['\t@AGENTS.md', false],
  ['Read\n    @AGENTS.md', true],
  ['---\nx: @AGENTS.md\n---', false],
  ['---\nname: rules\n---\n@AGENTS.md', true],
  ['﻿---\nnote: @AGENTS.md\n---\n@README.md', false],
  ['<div>\n@AGENTS.md\n</div>', false],
  ['<!--\n@AGENTS.md', false],
  ['<!-- note --> @AGENTS.md', true],
  ['@AGENTS.mdx', false],
  ['@../AGENTS.md', false],
  ['@../../AGENTS.md', false],
  ['@/AGENTS.md', false],
  ['@~/AGENTS.md', false],
  ['@~/../AGENTS.md', false],
  ['@C:/../AGENTS.md', false],
  ['@..\\docs/../AGENTS.md', false],
];

function kitLeavesOutItsImport(text: string): boolean {
  const tree: RenderTree = new Map([['CLAUDE.md', [blockEntry('agents-import', '@AGENTS.md')]]]);
  const read = (file: string): string | undefined => (file === 'CLAUDE.md' ? text : undefined);
  return !withoutImportedBlocks(tree, read, TEST_BRAND).has('CLAUDE.md');
}

describe('the @ import readers of the kit and of the context budget', () => {
  it.each(CASES)('agree on whether %j imports AGENTS.md', (text, imports) => {
    expect(importsOf(text).includes('AGENTS.md')).toBe(imports);
    expect(kitLeavesOutItsImport(text)).toBe(imports);
  });

  it('read unclosed comments after a closed one within a second', () => {
    const text = `<!-- -->${'<!--'.repeat(120_000)}@AGENTS.md`;
    const started = performance.now();
    importsOf(text);
    kitLeavesOutItsImport(text);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('read a paragraph of about 100,000 imports without throwing', () => {
    const text = Array.from({ length: 100_000 }, (_, index) => `@docs/f${String(index)}.md`).join(' ');
    expect(importsOf(text)).toHaveLength(100_000);
    expect(() => kitLeavesOutItsImport(text)).not.toThrow();
  });
});
