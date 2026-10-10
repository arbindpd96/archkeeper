import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type BlockEdits, editBlocks } from '../src/core/blocks-edit.js';
import { type BlockPart, blockParts, parseBlocks } from '../src/core/blocks-file.js';
import { BYTE_ORDER_MARK } from '../src/core/text.js';
import { MergeError } from '../src/core/errors.js';
import { markerIn, markerPattern } from '../src/core/markers.js';
import { memoryImports } from '../src/core/memory-imports.js';
import { unsafeValue } from '../src/core/template.js';
import { TEST_BRAND } from './kit-fixtures.js';

const BEGIN = (id: string): string => `<!-- acmekit:begin ${id} -->`;
const END = (id: string): string => `<!-- acmekit:end ${id} -->`;
const NO_EDITS: BlockEdits = { replace: new Map(), remove: new Set(), insert: [] };

function joined(text: string): string {
  const file = parseBlocks('AGENTS.md', text, TEST_BRAND);
  return editBlocks(file, NO_EDITS, TEST_BRAND.markerPrefix);
}

function mergeError(path: string, text: string): MergeError {
  try {
    parseBlocks(path, text, TEST_BRAND);
  } catch (error) {
    if (error instanceof MergeError) return error;
    throw error;
  }
  throw new Error('the file parsed without an error');
}

describe('parseBlocks', () => {
  it('splits a Markdown file into user text and blocks', () => {
    const text = `# Rules\n\n${BEGIN('a')}\nkit\n${END('a')}\nmine\n`;
    const file = parseBlocks('AGENTS.md', text, TEST_BRAND);
    expect(file.parts.map((part) => part.kind)).toEqual(['text', 'block', 'text']);
    expect(blockParts(file).get('a')?.body).toBe('kit\n');
  });

  it('reads # markers in .gitignore and .gitattributes', () => {
    const text = '# acmekit:begin base\n.acmekit/local/\n# acmekit:end base\nnode_modules/\n';
    expect(blockParts(parseBlocks('.gitignore', text, TEST_BRAND)).get('base')?.body).toBe(
      '.acmekit/local/\n',
    );
    expect(blockParts(parseBlocks('.gitattributes', text, TEST_BRAND)).has('base')).toBe(true);
  });

  it('reads markers under a legacy slug of the brand', () => {
    const text = '<!-- oldkit:begin a -->\nold\n<!-- oldkit:end a -->\n';
    expect(blockParts(parseBlocks('CLAUDE.md', text, TEST_BRAND)).get('a')?.body).toBe('old\n');
  });

  it.each([
    ['plain text with no trailing newline', 'just text'],
    ['CRLF line endings', `a\r\n${BEGIN('x')}\r\nkit\r\n${END('x')}\r\nb\r\n`],
    ['a byte-order mark', `${BYTE_ORDER_MARK}${BEGIN('x')}\nkit\n${END('x')}\n`],
    ['an end marker with no newline', `${BEGIN('x')}\nkit\n${END('x')}`],
    ['an empty block', `${BEGIN('x')}\n${END('x')}\n`],
    ['an empty file', ''],
    ['trailing blanks after a marker', `${BEGIN('x')}  \nkit\n${END('x')}\t\n`],
  ])('gives back every byte of %s', (_name, text) => {
    expect(joined(text)).toBe(text);
  });

  it.each([
    ['a marker that is not the whole line', `see ${BEGIN('a')}\n`, 'line 1', 'not a whole marker line'],
    ['a marker in upper case', `x\n<!-- ACMEKIT:BEGIN a -->\n`, 'line 2', 'holds acmekit:begin'],
    ['a # marker in Markdown', '# acmekit:begin a\n', 'line 1', 'not a whole marker line'],
    ['an id that is not kebab-case', '<!-- acmekit:begin A_b -->\n', 'line 1', 'not a whole marker line'],
    ['two spaces in a marker', '<!--  acmekit:begin a -->\n', 'line 1', 'not a whole marker line'],
    ['an end with no begin', `${END('a')}\n`, 'line 1', 'closes block "a", which is not open'],
    ['a begin with no end', `x\n${BEGIN('a')}\nkit\n`, 'line 2', 'opens block "a", which is never closed'],
    ['a nested begin', `${BEGIN('a')}\n${BEGIN('b')}\n`, 'line 2', 'inside block "a", opened on line 1'],
    ['a mismatched end', `${BEGIN('a')}\n${END('b')}\n`, 'line 2', 'closes block "b" while block "a"'],
    [
      'an end under another prefix',
      `<!-- oldkit:begin a -->\n${END('a')}\n`,
      'line 2',
      'closes block "a" with acmekit:end, but it opens with oldkit:begin on line 1',
    ],
    [
      'a repeated block',
      `${BEGIN('a')}\n${END('a')}\n${BEGIN('a')}\n${END('a')}\n`,
      'line 3',
      'repeats block "a", which already opens on line 1',
    ],
  ])('refuses %s, naming the line', (_name, text, line, problem) => {
    const error = mergeError('AGENTS.md', text);
    expect(error.location).toBe(line);
    expect(error.message).toContain(problem);
    expect(error.message).toContain('AGENTS.md');
  });

  it('reads a marker spelled with spaces as user text, since no value can hold the real one', () => {
    const text = 'acmekit : end a\n';
    expect(parseBlocks('AGENTS.md', text, TEST_BRAND).parts).toEqual([{ kind: 'text', text }]);
  });
});

describe('one marker regex for render and the parser', () => {
  const fragments = ['acmekit', 'oldkit', ':begin', ':end', ' ', ':', 'ACME', 'kit', 'ſ', 'K', '-->', '<!--'];
  const line = fc
    .array(fc.oneof(fc.constantFrom(...fragments), fc.string({ maxLength: 4 })), { maxLength: 8 })
    .map((parts) => parts.join('').replace(/[\r\n]/g, ''));

  function readAsMarker(value: string): boolean {
    try {
      return parseBlocks('AGENTS.md', `${value}\n`, TEST_BRAND).parts.some((part) => part.kind === 'block');
    } catch (error) {
      if (error instanceof MergeError) return true;
      throw error;
    }
  }

  it('refuses a template value exactly when the parser reads its line as a marker', () => {
    fc.assert(
      fc.property(line, (value) => {
        const problem = unsafeValue({ value }, TEST_BRAND)?.problem;
        fc.pre(problem === undefined || problem.includes('marks a managed block'));
        expect(readAsMarker(value)).toBe(problem !== undefined);
      }),
      { numRuns: 2000 },
    );
  });

  it('matches the prefix and legacy slugs in any case, and folds Unicode case', () => {
    expect(markerIn('x ACMEKIT:End y', TEST_BRAND)).toBe('acmekit:end');
    expect(markerIn('oldkit:begin', TEST_BRAND)).toBe('oldkit:begin');
    expect(markerPattern(TEST_BRAND).test('acmeKit:begin')).toBe(true);
    expect(markerIn('acmekit : end', TEST_BRAND)).toBeUndefined();
  });
});

describe('editBlocks', () => {
  const edit = (path: string, text: string, edits: Partial<BlockEdits>): string =>
    editBlocks(parseBlocks(path, text, TEST_BRAND), { ...NO_EDITS, ...edits }, TEST_BRAND.markerPrefix);

  it('puts a new block of imports first and appends any other block after a blank line', () => {
    const text = '# Project\n\nNotes.';
    const result = edit('CLAUDE.md', text, {
      insert: [
        { id: 'notes', body: 'More.\n' },
        { id: 'imports', body: '@AGENTS.md\n' },
      ],
    });
    expect(result).toBe(
      `${BEGIN('imports')}\n@AGENTS.md\n${END('imports')}\n\n# Project\n\nNotes.\n\n${BEGIN('notes')}\nMore.\n${END('notes')}\n`,
    );
  });

  it('puts a new block of imports after a leading YAML frontmatter, so Claude Code still reads it as frontmatter', () => {
    const imports = { insert: [{ id: 'imports', body: '@AGENTS.md\n' }] };
    const block = `${BEGIN('imports')}\n@AGENTS.md\n${END('imports')}\n`;
    const result = edit('CLAUDE.md', '---\nname: rules\n---\n# Project\n', imports);
    expect(result).toBe(`---\nname: rules\n---\n${block}\n# Project\n`);
    expect(memoryImports(result)).toEqual(['AGENTS.md']);
    expect(edit('CLAUDE.md', '---\nname: rules\n---', imports)).toBe(`---\nname: rules\n---\n${block}`);
  });

  it('puts a new block of imports after a frontmatter that follows a byte-order mark, with CRLF endings', () => {
    const text = `${BYTE_ORDER_MARK}---\r\nname: rules\r\n---\r\nBody\r\n`;
    expect(edit('CLAUDE.md', text, { insert: [{ id: 'imports', body: '@AGENTS.md\n' }] })).toBe(
      `${BYTE_ORDER_MARK}---\r\nname: rules\r\n---\r\n${BEGIN('imports')}\r\n@AGENTS.md\r\n${END('imports')}\r\n\r\nBody\r\n`,
    );
  });

  it("puts a new block of imports after a kept block that holds the frontmatter's closing line, never inside it", () => {
    const kept = `${BEGIN('claude-code')}\nA\n---\nB\n${END('claude-code')}\n`;
    const result = edit('CLAUDE.md', `---\nIntro\n${kept}`, {
      insert: [{ id: 'imports', body: '@AGENTS.md\n' }],
    });
    expect(result).toBe(`---\nIntro\n${kept}${BEGIN('imports')}\n@AGENTS.md\n${END('imports')}\n`);
    expect([...blockParts(parseBlocks('CLAUDE.md', result, TEST_BRAND)).keys()]).toEqual([
      'claude-code',
      'imports',
    ]);
    expect(memoryImports(result)).toEqual(['AGENTS.md']);
  });

  it('writes new and replaced blocks with the CRLF endings and byte-order mark the file has', () => {
    const text = `${BYTE_ORDER_MARK}user\r\n${BEGIN('a')}\r\nold\r\n${END('a')}\r\n`;
    const result = edit('AGENTS.md', text, {
      replace: new Map([['a', 'new\n']]),
      insert: [{ id: 'b', body: 'b\n' }],
    });
    expect(result).toBe(
      `${BYTE_ORDER_MARK}user\r\n${BEGIN('a')}\r\nnew\r\n${END('a')}\r\n\r\n${BEGIN('b')}\r\nb\r\n${END('b')}\r\n`,
    );
  });

  it('removes a block and keeps every byte around it', () => {
    const text = `a\n${BEGIN('x')}\nkit\n${END('x')}\nb\n`;
    expect(edit('AGENTS.md', text, { remove: new Set(['x']) })).toBe('a\nb\n');
  });

  it('keeps the marker lines of a block it replaces, legacy prefix included', () => {
    const text = '<!-- oldkit:begin a -->\nold\n<!-- oldkit:end a -->\n';
    expect(edit('AGENTS.md', text, { replace: new Map([['a', 'new\n']]) })).toBe(
      '<!-- oldkit:begin a -->\nnew\n<!-- oldkit:end a -->\n',
    );
  });

  it('creates a .gitignore with # markers', () => {
    expect(edit('.gitignore', '', { insert: [{ id: 'base', body: 'dist/\n' }] })).toBe(
      '# acmekit:begin base\ndist/\n# acmekit:end base\n',
    );
  });

  it('keeps the block part shape for callers', () => {
    const part: BlockPart | undefined = blockParts(
      parseBlocks('a.md', `${BEGIN('a')}\nx\n${END('a')}\n`, TEST_BRAND),
    ).get('a');
    expect(part).toEqual({
      kind: 'block',
      id: 'a',
      begin: `${BEGIN('a')}\n`,
      body: 'x\n',
      end: `${END('a')}\n`,
    });
  });
});
