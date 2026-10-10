import { describe, expect, it } from 'vitest';
import { importsOf } from '../scripts/context-rules.mjs';
import { withoutImportedBlocks } from '../src/core/import-blocks.js';
import type { RenderTree } from '../src/core/render.js';
import { blockEntry, TEST_BRAND } from './kit-fixtures.js';

// The two readers of the @ import grammar stay separate on purpose (the M3 memory says why); one table keeps them equal.
const CASES: readonly (readonly [text: string, imports: boolean])[] = [
  ['@AGENTS.md', true],
  ['Shared rules: @AGENTS.md.', true],
  ['**@AGENTS.md**', true],
  ['(@AGENTS.md)', true],
  ['[@AGENTS.md], then more', true],
  ['run `npm test`@AGENTS.md', true],
  ['run`npm test`@AGENTS.md', true],
  ['mail docs@AGENTS.md', false],
  ['@@AGENTS.md', false],
  ['`@AGENTS.md`', false],
  ['see ` @AGENTS.md ` here', false],
  ['```\n@AGENTS.md\n```', false],
  ['   ~~~md\n@AGENTS.md\n   ~~~', false],
  ['```\ncode\n```\n@AGENTS.md', true],
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
});
