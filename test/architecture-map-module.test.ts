import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../src/core/blocks-file.js';
import { fixtureCopy, writeFiles } from './helpers.js';
import { moduleContent, moduleEntries, renderedKit, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';
import { frontmatterOf, skillProblems } from './static-rules.js';

const MAP = 'docs/architecture.md';
const SKILL = '.claude/skills/update-map/SKILL.md';
const TREE = renderedKit(['base', 'architecture-map']);

interface Summary {
  readonly plan: readonly { readonly ops: readonly { readonly kind: string }[] }[];
}

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

/** The lines of a `##` section of a Markdown text, without the blank lines around them. */
function section(text: string, heading: string): string[] {
  const body = text.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
  return body.trim().split('\n');
}

async function mediumInit(fixture: string, tracked?: readonly string[] | null): Promise<string> {
  const { dir } = fixtureCopy(fixture);
  const setup = tracked === undefined ? {} : { tracked };
  expect((await runInit(dir, ['--yes', '--preset', 'medium'], setup)).code).toBe(0);
  return dir;
}

describe('the architecture-map module (#36)', () => {
  it('writes the map once, and owns the /update-map skill and its AGENTS.md block', () => {
    expect(moduleEntries(TREE, 'architecture-map')).toEqual([
      [SKILL, 'owned', ''],
      ['AGENTS.md', 'blocks', 'architecture-map'],
      [MAP, 'create-only', ''],
    ]);
  });

  it('keeps the Overview to a prompt in a comment and the stack line, since session start injects it', () => {
    const overview = section(moduleContent(TREE, 'architecture-map', MAP), 'Overview');
    expect(overview).toHaveLength(3);
    expect(overview[0]).toMatch(/^<!-- .+ -->$/);
    expect(overview.slice(1)).toEqual(['', '- Stack: not detected']);
  });

  it('lets Claude list tracked files without a prompt, and nothing else, with no load-time command', () => {
    const skill = moduleContent(TREE, 'architecture-map', SKILL);
    expect(skillProblems(skill)).toEqual([]);
    const fields = frontmatterOf(skill);
    expect(fields?.get('allowed-tools')).toBe('Read, Grep, Glob, Bash(git ls-files)');
    expect(fields?.has('disable-model-invocation')).toBe(false);
    expect(fields?.get('description')).toMatch(
      /Use after adding or removing a module, package, command or shared util\.$/,
    );
    expect(skill).not.toContain('!`');
  });

  it('tells Claude what to update, what to leave alone and how to report', () => {
    const skill = moduleContent(TREE, 'architecture-map', SKILL);
    for (const step of [
      'Run `git ls-files`',
      'the first 400 paths are enough',
      'look for them with Glob too',
      'In **Layout**, add a row for each new folder',
      'Fill in each empty Purpose cell',
      'In **Entry points**',
      'Keep **Overview** to a few lines',
      'Never write between the two marker lines under **Index**',
      'Keep the text the user wrote',
      'If it is missing, create it',
      'Report what changed as a short list',
    ]) {
      expect(skill).toContain(step);
    }
  });

  it('tells agents to check the map before creating anything and to update it afterwards', () => {
    const block = moduleContent(TREE, 'architecture-map', 'AGENTS.md');
    expect(block).toContain('`docs/architecture.md`');
    expect(block).toContain('Before creating anything new, check the map');
    expect(block).toContain(
      'After adding or removing a module, package, command or shared util, update the map with `/update-map`.',
    );
  });
});

describe('init with the architecture-map module (#36)', () => {
  it.each([
    ['ts-app', 'TypeScript (npm)', ['docs/', 'src/', 'test/', 'docs/adr/']],
    ['py-app', 'Python (pip)', ['src/', 'tests/', 'src/py_app/']],
    ['mixed', 'TypeScript and Python (npm, pip)', ['api/', 'web/']],
  ])('seeds the map of %s with its stack and its tracked folders', async (fixture, stack, folders) => {
    const map = read(await mediumInit(fixture), MAP);
    expect(section(map, 'Overview').at(-1)).toBe(`- Stack: ${stack}`);
    const rows = folders.map((folder) => `| \`${folder}\` | |`);
    expect(section(map, 'Layout')).toEqual(['| Path | Purpose |', '| --- | --- |', ...rows]);
    expect(section(map, 'Entry points')).toEqual(['None found in `package.json` or `pyproject.toml`.']);
  });

  it('reserves an empty index block, under a line asking to write nothing in it', async () => {
    const map = read(await mediumInit('ts-app'), MAP);
    const index = parseBlocks(MAP, map, TEST_BRAND).parts.filter((part) => part.kind === 'block');
    expect(index).toMatchObject([{ id: 'index', body: '' }]);
    expect(section(map, 'Index')[0]).toMatch(/^Write nothing between the two marker lines below/);
  });

  it('asks for /update-map in the Layout when git gives no list of tracked files', async () => {
    const map = read(await mediumInit('ts-app', null), MAP);
    expect(section(map, 'Layout')).toEqual(['Run `/update-map` to list the project folders here.']);
  });

  it('leaves out tracked names that could break the map, and still writes it', async () => {
    const tracked = [
      'src/a.ts',
      'bad`name/x.ts',
      `${TEST_BRAND.markerPrefix}:end index/x.ts`,
      'a<!--b/x',
      'c-->d/x',
    ];
    const map = read(await mediumInit('py-app', tracked), MAP);
    expect(section(map, 'Layout')).toEqual(['| Path | Purpose |', '| --- | --- |', '| `src/` | |']);
  });

  it("keeps a project's own docs/architecture.md byte for byte, with no sidecar", async () => {
    const { dir } = fixtureCopy('ts-app');
    writeFiles(dir, { [MAP]: '# Our map\r\n\r\nHand-written.\r\n' });
    expect((await runInit(dir, ['--yes', '--preset', 'medium'])).code).toBe(0);
    expect(read(dir, MAP)).toBe('# Our map\r\n\r\nHand-written.\r\n');
    expect(existsSync(path.join(dir, `${MAP}${TEST_BRAND.sidecarSuffix}`))).toBe(false);
  });

  it('plans only skips on a second init, though the tracked files changed since the map was seeded', async () => {
    const dir = await mediumInit('ts-app');
    const before = read(dir, MAP);
    const again = await runInit(dir, ['--json'], { tracked: ['src/billing/total.ts', 'src/a.ts'] });
    expect(again.code).toBe(0);
    const { plan } = JSON.parse(again.stdout) as Summary;
    expect(plan.flatMap((entry) => entry.ops).filter((op) => op.kind !== 'skip')).toEqual([]);
    expect(read(dir, MAP)).toBe(before);
  });

  it('writes nothing of its own with the small preset', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes', '--preset', 'small'])).code).toBe(0);
    expect(existsSync(path.join(dir, MAP))).toBe(false);
    expect(existsSync(path.join(dir, '.claude/skills/update-map'))).toBe(false);
    expect(read(dir, 'AGENTS.md')).not.toContain('architecture-map');
  });
});
