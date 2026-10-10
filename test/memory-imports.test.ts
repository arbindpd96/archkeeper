import { describe, expect, it } from 'vitest';
import { memoryImports, skipsMemoryFile } from '../src/core/memory-imports.js';

// A CLAUDE.md text and whether Claude Code 2.1.295 imports AGENTS.md from it, each checked by running the
// extractor and the marked copied out of its binary. The rows from the hand-written reader's fuzzing come first,
// then the security review's kinds of text that reader still misread (tabs in list items, link definitions in
// lists, lazy lines in nested quotes, code spans across quote lines, unclosed HTML blocks, emphasis closers and
// `@\ `), none of which Claude Code imports.
const ROWS: readonly (readonly [text: string, imports: boolean])[] = [
  ['- Run:\n    ```bash\n    @AGENTS.md\n    ```', false],
  ['- Run:\n    ```bash\n    npm test\n    ```\n\n@AGENTS.md', true],
  ['1. Install:\n   ```bash\n   npm ci\n   ```\n2. Read @AGENTS.md', true],
  ['- item\n<div>\n@AGENTS.md', false],
  ['- item\n\n  <details>\n  @AGENTS.md', false],
  ['-     @AGENTS.md', false],
  ['- ```\n  @AGENTS.md\n  ```', false],
  ['> ```\n> @AGENTS.md\n> ```', false],
  ['> quote\n> ```\n@AGENTS.md\n```', false],
  ['> Read\n@AGENTS.md', true],
  ['> @AGENTS.md', true],
  ['Title\n=====\n    @AGENTS.md', false],
  ['text\n***\n=\n    @AGENTS.md', false],
  ['[rules]: @AGENTS.md', false],
  ['[rules]:\n@AGENTS.md', false],
  ['[rules]: x\n\n@AGENTS.md', true],
  ['![ @AGENTS.md](x)', false],
  ['[x]( @AGENTS.md )', false],
  ['<span>@AGENTS.md</span> is the import', true],
  ['<a title= @AGENTS.md>', false],
  ['<!-- x --> **@AGENTS.md**', false],
  ['<!--\n@AGENTS.md\n-->', false],
  ['<!--\nnote\n--> @AGENTS.md', true],
  ['<p\n\n@AGENTS.md', false],
  ['<pre>\n\n@AGENTS.md\n</pre>', false],
  ['<?php\n\n@AGENTS.md ?>', false],
  ['*<!-->*@AGENTS.md*', false],
  ['__``_``@AGENTS.md', false],
  ['**@AGENTS.md\\ **', false],
  ['**@AGENTS.md***', true],
  ['Use `foo\n@AGENTS.md bar`', false],
  ['\\`` @AGENTS.md `', false],
  ['@\\ AGENTS.md', false],
  ['- see ` @AGENTS.md ` x', true],
  ['- [ref]: x\n  @AGENTS.md', true],
  ['* d\n[a]:\n>@AGENTS.md', false],
  ['n\n***\n=\n    _@AGENTS.md_', false],
  ['1. a\nx y~~~\n>\n    @AGENTS.md', false],
  ['@AGENTS.md\n```', true],
  ['@AGENTS.md\n\n```', true],
  ['>#\n\t\n=\n    @AGENTS.md', false],
  ['1. )\n@AGENTS.md<?\n    =\n?>', false],
  ['1. @AGENTS.md<?\n    2) ?>', false],
  ['Use **bold** and **@AGENTS.md**', true],
  ['> quote\nlazy text\n@AGENTS.md', true],
  ['> quote\n\n@AGENTS.md', true],
  ['- a\n  - b\n\n  more\n\n@AGENTS.md', true],
  ['- a\n  - b\n- c\n\n@AGENTS.md', true],
  ['>*<!X @AGENTS.md\n>  \n\t>', false],
  ['\\`*d*`\n**@AGENTS.md**``*', false],
  ['*\n\n* \n<!X\n@AGENTS.md', false],
  ['![\n@AGENTS.md\\[]()', false],
  ['![a\\](b)@AGENTS.md', false],
  ['2)   t\n>\n    v@AGENTS.md', false],
  ['2)   1. \n\n\t@AGENTS.md', false],
  ['1. =\n>.<!X @AGENTS.md\nt\n<?>', false],
  ['[ @AGENTS.md``]()``', false],
  ['\\\\![ @AGENTS.md\\\\]()', false],
  ['[ @AGENTS.md<!--]()-->', false],
  ['\\\\[ @AGENTS.md<!--]()-->', false],
  ['2)   .<?\n    -\n@AGENTS.md<v>?>', false],
  ['2)    - x\n-<!X\n2) @AGENTS.md\nv>', false],
  ['>  \n2) #\n\n\t@AGENTS.md', false],
  ['>\t\n    .\n-\n    @AGENTS.md', false],
  ['2)  \n1. \n<!X\n```>\n@AGENTS.md', false],
  ['-\n* \n<?\n```?>\n@AGENTS.md', false],
  ['2) :\n1. \n   .<? @AGENTS.md\n?>', false],
  ['-     1.\n         @AGENTS.md', false],
  ['1. - - \n    *\n\n       @AGENTS.md', false],
  ['- a <!X\n    # b\n  @AGENTS.md >', true],
  ['-\n  >\t @AGENTS.md', false],
  ['>@AGENTS.md<?\n>-\n?>', false],
  ['* )\n    -\n      @AGENTS.md', false],
  ['-\n- --\n    @AGENTS.md', false],
  ['- a\n  -\n\n  @AGENTS.md', true],
  ['* - --\n      @AGENTS.md', false],
  ['  2) ?\ntext\t @AGENTS.md<!X\n?>', false],
  ['*  \n    ---\n      @AGENTS.md', false],
  ['- a\n\n    # @AGENTS.md', true],
  ['*\n\t1.\n      @AGENTS.md', false],
  ['-\t\t@AGENTS.md', false],
  ['1.\t\t@AGENTS.md', false],
  ['-\t\ta\n\t\t@AGENTS.md', false],
  ['- a\n\n\t\t@AGENTS.md', false],
  ['-\ta\n\n\t\t@AGENTS.md', false],
  ['- [a]:\n  @AGENTS.md', false],
  ['- [a]: x\n  [b]:\n  @AGENTS.md', false],
  ["- [a]: x 'b\n  @AGENTS.md'", false],
  ['- [a]: x (b\n  @AGENTS.md)', false],
  ['1. [a]:\n   <@AGENTS.md>', false],
  ['> > a\n```\n@AGENTS.md', false],
  ['> > a\n> ```\n@AGENTS.md', false],
  ['> > a\n<!--\n@AGENTS.md', false],
  ['> > a\n<div>\n@AGENTS.md', false],
  ['> > - a\n~~~\n@AGENTS.md', false],
  ['> `a\n> @AGENTS.md`', false],
  ['> `a\n@AGENTS.md`', false],
  ['> a `b\n> > @AGENTS.md`', false],
  ['> ``a\n> @AGENTS.md``', false],
  ['- `a\n  @AGENTS.md`', false],
  ['<p\n@AGENTS.md', false],
  ['</div\n@AGENTS.md', false],
  ['<?\n@AGENTS.md', false],
  ['<!X\n@AGENTS.md', false],
  ['<![CDATA[\n@AGENTS.md', false],
  ['<script>\n\n@AGENTS.md', false],
  ['<textarea>\n\n\n@AGENTS.md', false],
  ['<x-y>\n@AGENTS.md', false],
  ['<a href="x">\n@AGENTS.md', false],
  ['- <div>\n  @AGENTS.md', false],
  ['**@AGENTS.md*', false],
  ['_@AGENTS.md_a', false],
  ['__@AGENTS.md__a', false],
  ['***@AGENTS.md*', false],
  ['***@AGENTS.md**', false],
  ['*a **@AGENTS.md*', false],
  ['a*@AGENTS.md*', false],
  ['@\\ @AGENTS.md', false],
  ['a @\\ @AGENTS.md', false],
  ['@a\\ @AGENTS.md', false],
];

const MIB = 1_048_576;
const fill = (unit: string, length: number): string => unit.repeat(Math.ceil(length / unit.length));

// Text a hostile repository could commit to keep init busy, where marked itself is slow (deep nesting, emphasis
// openers, lazy lines, masked spans) or was for the hand-written reader. Each must finish within a second.
const ADVERSARIAL: readonly (readonly [name: string, text: string])[] = [
  ['dots after an @', `@${'.'.repeat(200_000)}x`],
  [
    'backtick runs of every length',
    Array.from({ length: 600 }, (_, run) => `${'`'.repeat(run + 1)} x `).join(''),
  ],
  ['unclosed comments', '<!--'.repeat(50_000)],
  ['unclosed comments after a closed one', `<!-- -->${'<!--'.repeat(120_000)}@AGENTS.md`],
  ['unclosed images', '![a'.repeat(70_000)],
  ['unclosed tag quotes', '<a b="'.repeat(35_000)],
  ['emphasis openers', '**@a** '.repeat(30_000)],
  ['list items', '- a\n'.repeat(50_000)],
  ['lazy quote lines', `> a\n${'b\n'.repeat(100_000)}`],
  ["the security review's nested list", `${'- '.repeat(4000)}x\n${'y\n'.repeat(4000)}@AGENTS.md`],
  ['nested bullets on one line, 1 MiB', `${fill('- ', MIB / 2)}x\n${fill('y\n', MIB / 2)}@AGENTS.md`],
  ['nested numbers on one line, 1 MiB', `${fill('1. ', MIB / 2)}x\n${fill('y\n', MIB / 2)}@AGENTS.md`],
  ['nested quotes on one line, 1 MiB', `${fill('> ', MIB / 2)}x\n${fill('y\n', MIB / 2)}@AGENTS.md`],
  ['quotes in lists on one line, 1 MiB', `${fill('> - ', MIB / 2)}x\n${fill('y\n', MIB / 2)}@a`],
  ['tabs after bullets, 1 MiB', `${fill('-\t', MIB)}@a`],
  [
    'lists nested by indentation, 1 MiB',
    Array.from({ length: 1000 }, (_, level) => `${' '.repeat(2 * level)}- @a\n`).join(''),
  ],
  ['emphasis openers before imports, 1 MiB', fill('*@a ', MIB)],
  ['an underscore run in a list item', `1. ${'_'.repeat(100_000)}@a`],
  ['lazy lines in a list item, 1 MiB', `- @a\n${fill('a\n', MIB)}`],
  ['a last line of tildes, 1 MiB', `@a\n${'~'.repeat(MIB)}`],
  ['lazy lines between nested quotes, 1 MiB', fill('    @a>\n> > ()\n', MIB)],
  ['code spans beside imports, 1 MiB', fill('`a` @b ', MIB)],
];

describe('memoryImports', () => {
  it.each(ROWS)('reads the AGENTS.md import of %j exactly where Claude Code does (%s)', (text, imports) => {
    expect(memoryImports(text).includes('AGENTS.md')).toBe(imports);
  });

  it('lists each path as written, cut at #, unescaped and trimmed, once', () => {
    expect(memoryImports('Read @docs/a\\ b.md#rules, @./c.md and @docs/a\\ b.md\\ ')).toEqual([
      'docs/a b.md',
      './c.md',
    ]);
  });

  it('skips YAML frontmatter after a byte-order mark, as Claude Code does', () => {
    expect(memoryImports('\uFEFF---\r\nnote: @x.md\r\n---\r\n@AGENTS.md')).toEqual(['AGENTS.md']);
  });

  it.each([
    'paths: &x [*x]',
    'paths: [&a [*a]]',
    'x: &a [*a]\npaths: *a',
    '"pa\\x74hs": [[x]]',
    'paths: ["src/*.ts"]',
  ])('counts nothing under frontmatter %j, where Claude Code expands paths and may skip the file', (yaml) => {
    expect(memoryImports(`---\n${yaml}\n---\n@AGENTS.md`)).toEqual([]);
    expect(memoryImports(`---\nname: rules\n---\n@AGENTS.md`)).toEqual(['AGENTS.md']);
  });

  it('counts nothing in a file over 4 MiB, which Claude Code skips whole', () => {
    expect(memoryImports(`@AGENTS.md\n${'a'.repeat(4 * MIB)}`)).toEqual([]);
  });

  it('counts nothing in a file whose import holds a NUL, which Claude Code skips whole', () => {
    expect(memoryImports('@AGENTS.md and @a\u0000b.md')).toEqual([]);
  });

  it('counts nothing past 64 levels of nesting, where Claude Code still reads the import', () => {
    expect(memoryImports(`${'> '.repeat(10)}@AGENTS.md`)).toEqual(['AGENTS.md']);
    expect(memoryImports(`${'> '.repeat(65)}@AGENTS.md`)).toEqual([]);
  });

  it('counts nothing in a text that takes more lexing work than the kit spends', () => {
    expect(memoryImports(`@AGENTS.md ${'*a '.repeat(500)}`)).toEqual(['AGENTS.md']);
    expect(memoryImports(`@AGENTS.md ${'*a '.repeat(20_000)}`)).toEqual([]);
  });

  it.each(ADVERSARIAL)('reads %s within a second', (_name, text) => {
    const started = performance.now();
    memoryImports(text);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('skipsMemoryFile', () => {
  it('skips a file over 4 MiB in UTF-8 bytes, as Claude Code does', () => {
    expect(skipsMemoryFile('a'.repeat(4 * MIB))).toBe(false);
    expect(skipsMemoryFile('a'.repeat(4 * MIB + 1))).toBe(true);
    expect(skipsMemoryFile('é'.repeat(2 * MIB + 1))).toBe(true);
    expect(skipsMemoryFile('€'.repeat(1_398_101))).toBe(false);
    expect(skipsMemoryFile('€'.repeat(1_398_102))).toBe(true);
  });
});
