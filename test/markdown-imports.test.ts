import { describe, expect, it } from 'vitest';
import { markdownImports } from '../src/core/markdown-imports.js';

// A CLAUDE.md text, whether Claude Code 2.1.295 imports AGENTS.md from it (checked against its lexer, marked 15
// without GFM), and whether the kit's reader counts that import. The reader may miss an import, which costs a
// redundant import line, but must never count one Claude Code does not read, which would leave AGENTS.md out.
const ROWS: readonly (readonly [text: string, claudeImports: boolean, counted: boolean])[] = [
  ['- Run:\n    ```bash\n    @AGENTS.md\n    ```', false, false],
  ['- Run:\n    ```bash\n    npm test\n    ```\n\n@AGENTS.md', true, true],
  ['1. Install:\n   ```bash\n   npm ci\n   ```\n2. Read @AGENTS.md', true, true],
  ['- item\n<div>\n@AGENTS.md', false, false],
  ['- item\n\n  <details>\n  @AGENTS.md', false, false],
  ['-     @AGENTS.md', false, false],
  ['- ```\n  @AGENTS.md\n  ```', false, false],
  ['> ```\n> @AGENTS.md\n> ```', false, false],
  ['> quote\n> ```\n@AGENTS.md\n```', false, false],
  ['> Read\n@AGENTS.md', true, true],
  ['> @AGENTS.md', true, true],
  ['Title\n=====\n    @AGENTS.md', false, false],
  ['text\n***\n=\n    @AGENTS.md', false, false],
  ['[rules]: @AGENTS.md', false, false],
  ['[rules]:\n@AGENTS.md', false, false],
  ['[rules]: x\n\n@AGENTS.md', true, true],
  ['![ @AGENTS.md](x)', false, false],
  ['[x]( @AGENTS.md )', false, false],
  ['<span>@AGENTS.md</span> is the import', true, true],
  ['<a title= @AGENTS.md>', false, false],
  ['<!-- x --> **@AGENTS.md**', false, false],
  ['<!--\n@AGENTS.md\n-->', false, false],
  ['<!--\nnote\n--> @AGENTS.md', true, true],
  ['<p\n\n@AGENTS.md', false, false],
  ['<pre>\n\n@AGENTS.md\n</pre>', false, false],
  ['<?php\n\n@AGENTS.md ?>', false, false],
  ['*<!-->*@AGENTS.md*', false, false],
  ['__``_``@AGENTS.md', false, false],
  ['**@AGENTS.md\\ **', false, false],
  ['**@AGENTS.md***', true, false],
  ['Use `foo\n@AGENTS.md bar`', false, false],
  ['\\`` @AGENTS.md `', false, false],
  ['@\\ AGENTS.md', false, false],
  ['- see ` @AGENTS.md ` x', true, false],
  ['- [ref]: x\n  @AGENTS.md', true, false],
  ['* d\n[a]:\n>@AGENTS.md', false, false],
  ['n\n***\n=\n    _@AGENTS.md_', false, false],
  ['1. a\nx y~~~\n>\n    @AGENTS.md', false, false],
  ['@AGENTS.md\n```', true, false],
  ['@AGENTS.md\n\n```', true, true],
  ['>#\n\t\n=\n    @AGENTS.md', false, false],
  ['1. )\n@AGENTS.md<?\n    =\n?>', false, false],
  ['1. @AGENTS.md<?\n    2) ?>', false, false],
  ['Use **bold** and **@AGENTS.md**', true, false],
  ['> quote\nlazy text\n@AGENTS.md', true, true],
  ['> quote\n\n@AGENTS.md', true, true],
  ['- a\n  - b\n\n  more\n\n@AGENTS.md', true, false],
  ['- a\n  - b\n- c\n\n@AGENTS.md', true, true],
  ['>*<!X @AGENTS.md\n>  \n\t>', false, false],
  ['\\`*d*`\n**@AGENTS.md**``*', false, false],
  ['*\n\n* \n<!X\n@AGENTS.md', false, false],
  ['![\n@AGENTS.md\\[]()', false, false],
  ['![a\\](b)@AGENTS.md', false, false],
  ['2)   t\n>\n    v@AGENTS.md', false, false],
  ['2)   1. \n\n\t@AGENTS.md', false, false],
  ['1. =\n>.<!X @AGENTS.md\nt\n<?>', false, false],
  ['[ @AGENTS.md``]()``', false, false],
  ['\\\\![ @AGENTS.md\\\\]()', false, false],
  ['[ @AGENTS.md<!--]()-->', false, false],
  ['\\\\[ @AGENTS.md<!--]()-->', false, false],
  ['2)   .<?\n    -\n@AGENTS.md<v>?>', false, false],
  ['2)    - x\n-<!X\n2) @AGENTS.md\nv>', false, false],
  ['>  \n2) #\n\n\t@AGENTS.md', false, false],
  ['>\t\n    .\n-\n    @AGENTS.md', false, false],
  ['2)  \n1. \n<!X\n```>\n@AGENTS.md', false, false],
  ['-\n* \n<?\n```?>\n@AGENTS.md', false, false],
  ['2) :\n1. \n   .<? @AGENTS.md\n?>', false, false],
  ['-     1.\n         @AGENTS.md', false, false],
  ['1. - - \n    *\n\n       @AGENTS.md', false, false],
  ['- a <!X\n    # b\n  @AGENTS.md >', true, true],
  ['-\n  >\t @AGENTS.md', false, false],
  ['>@AGENTS.md<?\n>-\n?>', false, false],
  ['* )\n    -\n      @AGENTS.md', false, false],
  ['-\n- --\n    @AGENTS.md', false, false],
  ['- a\n  -\n\n  @AGENTS.md', true, true],
  ['* - --\n      @AGENTS.md', false, false],
  ['  2) ?\ntext\t @AGENTS.md<!X\n?>', false, false],
  ['*  \n    ---\n      @AGENTS.md', false, false],
  ['- a\n\n    # @AGENTS.md', true, true],
  ['*\n\t1.\n      @AGENTS.md', false, false],
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
  ['list items', '- a\n'.repeat(50_000)],
  ['lazy quote lines', `> a\n${'b\n'.repeat(100_000)}`],
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
