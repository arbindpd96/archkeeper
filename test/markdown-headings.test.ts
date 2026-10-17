import { describe, expect, it } from 'vitest';
import { markdownHeadings } from '../src/core/markdown-headings.js';

const titles = (text: string): string[] => markdownHeadings(text.split('\n')).map((heading) => heading.title);

describe('markdownHeadings', () => {
  it('reads each ATX heading with its line, its level and its title', () => {
    expect(markdownHeadings(['# Map', '', 'Text.', '### Deep #3', '####### Not one', '#Nor this'])).toEqual([
      { line: 0, level: 1, title: 'Map' },
      { line: 3, level: 3, title: 'Deep #3' },
    ]);
  });

  it('drops a closing run of #s and the spaces around the title, as CommonMark does', () => {
    expect(titles('## Quick start ##\n## Spaced  \t\n## C#\n## ##\n## Ends\r')).toEqual([
      'Quick start',
      'Spaced',
      'C#',
      '',
      'Ends',
    ]);
  });

  it('skips every line inside a fenced code block of backticks or tildes', () => {
    expect(titles('```bash\n# install\n```\n# A\n~~~\n# not a heading\n~~~\n# B')).toEqual(['A', 'B']);
  });

  it('closes a fence only with one of the same character, at least as long and with nothing after it', () => {
    const text = [
      '~~~md',
      '```',
      '# inside the tildes',
      '~~~ not a closing fence',
      '~~',
      '~~~~',
      '# A',
      '````',
      '```',
      '# inside the backticks',
      '`````',
      '# B',
    ].join('\n');
    expect(titles(text)).toEqual(['A', 'B']);
  });

  it('opens no fence on a backtick line whose info string holds a backtick', () => {
    expect(titles('``` a`b\n# A\n')).toEqual(['A']);
  });

  it('reads a long hostile line in linear time', () => {
    const line = `## a${' '.repeat(100_000)}b${' #'.repeat(50_000)}x`;
    const start = performance.now();
    expect(markdownHeadings([line, `\`\`\`${'`'.repeat(100_000)}x`])).toHaveLength(1);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
