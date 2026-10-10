import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import { BRAND } from '../src/core/brand.js';
import { withoutImportedBlocks, withoutRefusedImports } from '../src/core/import-blocks.js';
import type { KitModule } from '../src/core/loader.js';
import { planInstall } from '../src/core/plan.js';
import { projectValues } from '../src/core/project-values.js';
import { render, type RenderTree } from '../src/core/render.js';
import type { StackProfile } from '../src/core/stack-profile.js';
import { git, REPO_ROOT, tempRepo } from './helpers.js';
import { blockEntry } from './kit-fixtures.js';

const catalog = readKit(REPO_ROOT);

function baseModule(): KitModule {
  const base = catalog.modules.get('base');
  if (base === undefined) throw new Error('modules/base is missing');
  return base;
}

const PROFILE: StackProfile = {
  stack: ['ts', 'python'],
  languages: ['typescript', 'python'],
  packageManager: 'pnpm',
  pythonManager: 'uv',
  tools: { formatters: [], linters: [], typeCheckers: [], testRunners: [] },
  frameworks: [],
  monorepo: false,
  commands: [
    { stack: 'ts', purpose: 'test', command: 'pnpm run test' },
    { stack: 'python', purpose: 'lint', command: 'uv run ruff check .' },
  ],
  docs: ['README.md'],
  claude: { claudeMd: false, agentsMd: false, settings: false, hooks: false, skills: false },
  warnings: [],
};

function baseTree(profile: StackProfile = PROFILE, stack = profile.stack): RenderTree {
  return render([baseModule()], {
    stack,
    values: projectValues(profile, stack),
  });
}

function freshFile(tree: RenderTree, file: string): string {
  const plan = planInstall(tree, new Map(), undefined, {
    kit: { name: 'kit', version: '1.0.0' },
    modules: ['base'],
  });
  return plan.writes.get(file) ?? '';
}

function blockOf(tree: RenderTree, file: string, id: string): string {
  return tree.get(file)?.find((entry) => entry.blockId === id)?.content ?? '';
}

describe('the base module', () => {
  it('writes a fresh CLAUDE.md under 100 lines that imports AGENTS.md exactly once, first', () => {
    const claude = freshFile(baseTree(), 'CLAUDE.md');
    const lines = claude.split('\n');
    expect(lines.length).toBeLessThan(100);
    expect(lines.filter((line) => line.includes('@AGENTS.md'))).toEqual(['@AGENTS.md']);
    expect(lines[1]).toBe('@AGENTS.md');
  });

  it('keeps the Claude-specific CLAUDE.md block to at most five pointer lines', () => {
    const pointers = blockOf(baseTree(), 'CLAUDE.md', 'claude-code').split('\n');
    expect(pointers.filter((line) => line.startsWith('- ')).length).toBeLessThanOrEqual(5);
  });

  it('gives AGENTS.md the four principles, the reuse rule and the commands of the stacks in effect', () => {
    const rules = blockOf(baseTree(), 'AGENTS.md', 'agent-rules');
    for (const heading of ['Think before coding', 'Simplicity first', 'Surgical changes', 'Goal-driven']) {
      expect(rules).toContain(`**${heading}.**`);
    }
    expect(rules).toContain('## Before creating anything new');
    expect(rules).toContain('| `pnpm run test` | Run the tests |');
    expect(rules).toContain('| `uv run ruff check .` | Lint |');
    expect(blockOf(baseTree(PROFILE, ['ts']), 'AGENTS.md', 'agent-rules')).not.toContain('ruff');
  });

  it('points only to docs that exist, and says so when no command was found', () => {
    expect(blockOf(baseTree(), 'AGENTS.md', 'agent-rules')).toContain('## Project docs\n\n- `README.md`');
    const bare = blockOf(baseTree({ ...PROFILE, docs: [], commands: [] }), 'AGENTS.md', 'agent-rules');
    expect(bare).not.toContain('Project docs');
    expect(bare).toContain('No build, test or lint commands were detected.');
  });

  it('says no commands were detected for the stacks in effect when the stack leaves out the detected ones', () => {
    const block = blockOf(baseTree(PROFILE, []), 'AGENTS.md', 'agent-rules');
    expect(block).toContain(
      'No build, test or lint commands were detected for the stacks this setup covers.',
    );
  });

  it('ignores the local files and the kit temp files of an interrupted write', () => {
    const lines = blockOf(baseTree(), '.gitignore', 'base').trimEnd().split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'CLAUDE.local.md',
      '.claude/settings.local.json',
      `${BRAND.stateDir}/local/`,
    ]);
    const repo = tempRepo();
    writeFileSync(path.join(repo, '.gitignore'), `${lines.join('\n')}\n`);
    expect(git(repo, 'check-ignore', '.CLAUDE.md.0123456789ab.tmp', 'docs/.notes.md.a1b2c3d4e5f6.tmp')).toBe(
      '.CLAUDE.md.0123456789ab.tmp\ndocs/.notes.md.a1b2c3d4e5f6.tmp\n',
    );
    expect(() => git(repo, 'check-ignore', '.notes.tmp', 'build.0123456789ab.tmp')).toThrow();
  });

  it('writes no settings, MCP servers or files the kit keeps private', () => {
    expect([...baseTree().keys()]).toEqual(['.gitignore', 'AGENTS.md', 'CLAUDE.md']);
  });
});

describe('withoutImportedBlocks', () => {
  const tree = baseTree();
  const marker = (edge: string, id: string): string => `<!-- ${BRAND.markerPrefix}:${edge} ${id} -->`;

  function keptBlocks(files: Readonly<Record<string, string>>): string[] {
    const kept = withoutImportedBlocks(tree, (file) => files[file]);
    return (kept.get('CLAUDE.md') ?? []).map((entry) => entry.blockId ?? '');
  }

  it.each([
    ['an import of its own', { 'CLAUDE.md': '# Notes\n\n@AGENTS.md\n' }],
    ['an import with ./', { 'CLAUDE.md': 'Read @./AGENTS.md first.\n' }],
    ['an import in inline markdown', { 'CLAUDE.md': 'Shared rules: **@AGENTS.md** (and @README.md).\n' }],
    ['an import in .claude/CLAUDE.md', { '.claude/CLAUDE.md': 'Rules: @../AGENTS.md\n' }],
    ['an import of a heading in AGENTS.md', { 'CLAUDE.md': 'Read @AGENTS.md#principles first.\n' }],
    ['an import of a heading in .claude/CLAUDE.md', { '.claude/CLAUDE.md': '@../AGENTS.md#top\n' }],
  ])('drops the import block when the project already has %s', (_name, files) => {
    expect(keptBlocks(files)).toEqual(['claude-code']);
  });

  it.each([
    ['no CLAUDE.md', undefined],
    ['no import', '# Notes\n'],
    ['the import only in a code fence', '```md\n@AGENTS.md\n```\n'],
    ['the import only in an HTML comment', '<!-- @AGENTS.md -->\n'],
    ['the import only in a code span', 'Write `@AGENTS.md` to import it.\n'],
    ['the import only in a code span with spaces', 'Write ` @AGENTS.md ` to import it.\n'],
    ['only an address that ends like it', 'Write to ops@AGENTS.md.\n'],
    ['only an import of the AGENTS.md above the project', '@../AGENTS.md\n'],
    ['only a path that ends in a full stop', 'Shared rules: @AGENTS.md.\n'],
    ['only an @ after a bracket', 'The shared rules (@AGENTS.md) apply.\n'],
    ['the import only in indented code', '# Notes\n\nTo import a file, write:\n\n    @AGENTS.md\n'],
    ['the import only in frontmatter', '---\nimports: @AGENTS.md\n---\n'],
    [
      "the import only in the kit's own block",
      `${marker('begin', 'agents-import')}\n@AGENTS.md\n${marker('end', 'agents-import')}\n`,
    ],
    [
      "only an indented import after the kit's own block, which Claude Code reads as code",
      `Intro\n${marker('begin', 'agents-import')}\n@AGENTS.md\n${marker('end', 'agents-import')}\n    @AGENTS.md\n`,
    ],
  ])('keeps the import block when there is %s', (_name, claude) => {
    expect(keptBlocks(claude === undefined ? {} : { 'CLAUDE.md': claude })).toEqual([
      'agents-import',
      'claude-code',
    ]);
  });

  it('reads a CLAUDE.md with a long run after an @ in linear time', () => {
    const started = performance.now();
    withoutImportedBlocks(tree, (file) => (file === 'CLAUDE.md' ? `@${'.'.repeat(200_000)}x\n` : undefined));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("gives a workspace package that imports the workspace's AGENTS.md an import of its own AGENTS.md", () => {
    const kept = withoutImportedBlocks(tree, (file) =>
      file === 'CLAUDE.md' ? 'Workspace rules: @../../AGENTS.md\n' : undefined,
    );
    const imports = kept.get('CLAUDE.md')?.find((entry) => entry.blockId === 'agents-import');
    expect(imports?.content).toBe('@AGENTS.md\n');
  });
});

describe('withoutRefusedImports', () => {
  it('leaves out a kit import that may name a file outside the project without asking the refusal', () => {
    const tree: RenderTree = new Map([['CLAUDE.md', [blockEntry('agents-import', '@../AGENTS.md\n')]]]);
    const asked: string[] = [];
    const result = withoutRefusedImports(tree, (target) => {
      asked.push(target);
      return undefined;
    });
    expect(result.tree.size).toBe(0);
    expect(result.refused).toEqual([
      { file: 'CLAUDE.md', target: '../AGENTS.md', reason: 'it may name a file outside the project' },
    ]);
    expect(asked).toEqual([]);
  });
});
