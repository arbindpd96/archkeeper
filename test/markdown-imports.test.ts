import { describe, expect, it } from 'vitest';
import { markdownImports } from '../src/core/markdown-imports.js';

// A CLAUDE.md text, whether Claude Code 2.1.295 imports AGENTS.md from it (checked against its lexer, marked 15
// without GFM), and whether the kit's reader counts that import. The reader may miss an import, which costs a
// redundant import line, but must never count one Claude Code does not read, which would leave AGENTS.md out.
const ROWS: readonly (readonly [text: string, claudeImports: boolean, counted: boolean])[] = [
  ['![ @AGENTS.md](x)', false, false],
  ['[x]( @AGENTS.md )', false, false],
  ['<span>@AGENTS.md</span> is the import', true, true],
  ['<a title= @AGENTS.md>', false, false],
  ['*<!-->*@AGENTS.md*', false, false],
  ['__``_``@AGENTS.md', false, false],
  ['**@AGENTS.md\\ **', false, false],
  ['**@AGENTS.md***', true, false],
  ['Use `foo\n@AGENTS.md bar`', false, false],
  ['\\`` @AGENTS.md `', false, false],
  ['@\\ AGENTS.md', false, false],
];

// Text a hostile repository could commit to keep init busy; each must take time linear in its length.
const ADVERSARIAL: readonly (readonly [name: string, text: string])[] = [
  ['dots after an @', `@${'.'.repeat(200_000)}x`],
  [
    'backtick runs of every length',
    Array.from({ length: 600 }, (_, run) => `${'`'.repeat(run + 1)} x `).join(''),
  ],
  ['unclosed comments', '<!--'.repeat(50_000)],
  ['unclosed images', '![a'.repeat(70_000)],
  ['unclosed tag quotes', '<a b="'.repeat(35_000)],
  ['emphasis openers', '**@a** '.repeat(30_000)],
];

describe('markdownImports', () => {
  it.each(ROWS)(
    'counts the AGENTS.md import of %j only where Claude Code reads it',
    (text, imports, counted) => {
      const found = markdownImports(text).includes('AGENTS.md');
      expect(found).toBe(counted);
      expect(found && !imports).toBe(false);
    },
  );

  it.each(ADVERSARIAL)('reads %s in linear time', (_name, text) => {
    const started = performance.now();
    markdownImports(text);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
