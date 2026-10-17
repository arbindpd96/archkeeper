import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureCopy } from './helpers.js';
import { filesUnder } from './install-helpers.js';
import { runInit } from './init-helpers.js';

const SKILL = /^\.claude\/skills\/[^/]+\/SKILL\.md$/;
// A doc path, in a code span or bare, as in a skill's description, runs to a space, a backtick or punctuation.
const DOC_PATH = /(?<![\w./-])docs\/[^\s`,;()]*/g;

// A `<placeholder>` stands for one name and `*` for part of one; a doc ending in / is a folder.
function partPattern(part: string): string {
  if (part === '*') return '[^/]*';
  if (part.startsWith('<')) return '[^/]+';
  return part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function docPattern(doc: string): RegExp {
  const source = doc
    .split(/(<[^>]+>|\*)/)
    .map(partPattern)
    .join('');
  return new RegExp(`^${source}${doc.endsWith('/') ? '' : '$'}`);
}

function docsNamedIn(text: string): string[] {
  return [...text.matchAll(DOC_PATH)].map((match) => match[0].replace(/[.:]+$/, ''));
}

// py-app has no docs folder of its own, so every doc found there is one the preset wrote.
describe.each(['small', 'medium', 'full'])('init with the %s preset (#34)', (preset) => {
  it('names in AGENTS.md and in its skills only docs that this preset writes', async () => {
    const { dir } = fixtureCopy('py-app');
    expect((await runInit(dir, ['--yes', '--preset', preset])).code).toBe(0);
    const files = filesUnder(dir);
    const readers = ['AGENTS.md', ...files.filter((file) => SKILL.test(file))];
    const named = readers.flatMap((reader) =>
      docsNamedIn(readFileSync(path.join(dir, reader), 'utf8')).map((doc) => ({ reader, doc })),
    );
    expect(named.length).toBeGreaterThan(0);
    const missing = named.filter(({ doc }) => !files.some((file) => docPattern(doc).test(file)));
    expect(missing).toEqual([]);
  });
});
