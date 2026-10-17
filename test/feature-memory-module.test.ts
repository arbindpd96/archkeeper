import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import { BRAND } from '../src/core/brand.js';
import { fixtureCopy, git, REPO_ROOT, withEnv, writeFiles } from './helpers.js';
import { memoryText } from './hook-helpers.js';
import { projectText } from './install-helpers.js';
import { moduleContent, moduleEntries, renderedKit, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';
import { frontmatterOf } from './static-rules.js';

const TEMPLATE = 'docs/features/_template/MEMORY.md';
const MISTAKES = 'docs/mistakes.md';
const POINTER = `${TEST_BRAND.stateDir}/local/active-feature`;
const TREE = renderedKit(['base', 'feature-memory']);
const KIT_ON_DISK = readKit(REPO_ROOT);
const LOGIN = 'docs/features/login/MEMORY.md';
const MEMORY_EVENTS = ['SessionStart', 'PreCompact', 'Stop'];

interface Handler {
  readonly command: string;
  readonly args: readonly string[];
}

/** Each registered hook's event and its arguments, with the project folder filled in as Claude Code does. */
function registered(dir: string): [string, string[]][] {
  const settings = parse(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')) as {
    hooks: Record<string, { hooks: Handler[] }[]>;
  };
  return Object.entries(settings.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      group.hooks.map((handler): [string, string[]] => {
        expect(handler.command).toBe('node');
        return [event, handler.args.map((arg) => arg.replace('${CLAUDE_PROJECT_DIR}', dir))];
      }),
    ),
  );
}

function runHook(dir: string, args: readonly string[], payload: unknown): string {
  const run = spawnSync(process.execPath, args, {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: withEnv({ CLAUDE_PROJECT_DIR: dir }),
  });
  expect(run.status).toBe(0);
  return run.stdout;
}

function written(file: string): string {
  return moduleContent(TREE, 'feature-memory', file);
}

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

describe('the feature-memory module (#34)', () => {
  it('writes the memory template and the mistakes log once, and owns its hooks, two skills and AGENTS.md block', () => {
    expect(moduleEntries(TREE, 'feature-memory')).toEqual([
      [`${TEST_BRAND.hookDir}/memory-stop.mjs`, 'owned', ''],
      [`${TEST_BRAND.hookDir}/pre-compact.mjs`, 'owned', ''],
      [`${TEST_BRAND.hookDir}/session-start.mjs`, 'owned', ''],
      ['.claude/settings.json', 'json', ''],
      ['.claude/skills/handoff/SKILL.md', 'owned', ''],
      ['.claude/skills/new-feature/SKILL.md', 'owned', ''],
      ['AGENTS.md', 'blocks', 'feature-memory'],
      [TEMPLATE, 'create-only', ''],
      [MISTAKES, 'create-only', ''],
    ]);
  });

  it('gives each feature a MEMORY.md template with the sections of handoff §5.2, in 80 lines or fewer', () => {
    const template = written(TEMPLATE);
    expect(template.trimEnd().split('\n').length).toBeLessThanOrEqual(80);
    expect(template.startsWith('# Feature: <name>\n\nStatus: in progress | Branch: <branch>\n')).toBe(true);
    expect([...template.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
      'Goal',
      'Decisions (never undo without asking)',
      'Done',
      'Next step',
      "Gotchas / don't try again",
      'Open questions',
    ]);
  });

  it('starts a feature only when the user asks, from the template', () => {
    const skill = written('.claude/skills/new-feature/SKILL.md');
    expect(frontmatterOf(skill)?.get('disable-model-invocation')).toBe('true');
    expect(skill).toContain(`Copy \`${TEMPLATE}\` to \`docs/features/<name>/MEMORY.md\``);
  });

  it('points the active-feature file at the new feature only over nothing or a name, and writes no ignore file', () => {
    const skill = written('.claude/skills/new-feature/SKILL.md');
    expect(skill).toContain(`Make it the active feature in \`${POINTER}\``);
    expect(skill).toContain('if it exists and holds anything other than one kebab-case name, stop');
    expect(skill).toContain('Otherwise write `<name>` as its only line.');
    expect(skill).not.toContain('.gitignore');
  });

  it('lets Claude save progress on its own, to the feature a kebab-case pointer names or the one in progress', () => {
    const skill = written('.claude/skills/handoff/SKILL.md');
    const fields = frontmatterOf(skill);
    expect(fields?.has('disable-model-invocation')).toBe(false);
    expect(fields?.get('description')).toMatch(
      /^Save this session's progress .* Use before ending a session/,
    );
    expect(skill).toContain(`the one named in \`${POINTER}\`, if that file holds one kebab-case name`);
    expect(skill).toContain('the only MEMORY.md in a kebab-case folder of `docs/features/` that says so');
    expect(skill).toContain(
      'Unless the user chose or confirmed that feature in this session, confirm it with them before you edit its memory',
    );
  });

  it('saves progress only into the active MEMORY.md and the mistakes log', () => {
    const skill = written('.claude/skills/handoff/SKILL.md');
    expect(skill).toContain(`editing only its MEMORY.md and \`${MISTAKES}\``);
    expect(skill).toContain(`add it to \`${MISTAKES}\``);
  });

  it('tells agents where the memory and the active feature live, and how to start and save a feature', () => {
    const block = written('AGENTS.md');
    expect(block).toContain('`docs/features/<feature>/MEMORY.md`');
    expect(block).toContain(
      `the one named in \`${POINTER}\`, else the only MEMORY.md that says \`Status: in progress\``,
    );
    expect(block).toContain('`/new-feature <name>`');
    expect(block).toContain('`/handoff`');
    expect(block).toContain(`\`${MISTAKES}\``);
    expect(block).toContain('Never contradict a recorded decision without asking the user first.');
  });
});

describe('the memory hooks (#35, ADR-0015)', () => {
  const manifest = KIT_ON_DISK.modules.get('feature-memory')?.manifest;

  it('registers session-start on every session start, pre-compact and memory-stop, each with a 10-second timeout', () => {
    expect(
      manifest?.hooks.map(({ event, matcher, script, timeout }) => [event, matcher, script, timeout]),
    ).toEqual([
      ['SessionStart', 'startup|resume|clear|compact', 'dist/hooks/session-start.mjs', 10],
      ['PreCompact', undefined, 'dist/hooks/pre-compact.mjs', 10],
      ['Stop', undefined, 'dist/hooks/memory-stop.mjs', 10],
    ]);
  });

  it('run as Claude Code runs them, from the real bundles under a path with a space', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes', '--preset', 'small'], { catalog: KIT_ON_DISK })).code).toBe(0);
    writeFiles(dir, { [LOGIN]: memoryText() });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'start');
    writeFiles(dir, { [`${BRAND.stateDir}/local/active-feature`]: 'login\n' });
    const hourAgo = new Date(Date.now() - 3_600_000);
    utimesSync(path.join(dir, LOGIN), hourAgo, hourAgo);
    writeFiles(dir, { 'src/greet.ts': 'export const greet = (name: string): string => `Hi ${name}`;\n' });
    const hooks = new Map(registered(dir).filter(([event]) => MEMORY_EVENTS.includes(event)));
    expect([...hooks.keys()].sort()).toEqual([...MEMORY_EVENTS].sort());
    const run = (event: string, payload: unknown): string => runHook(dir, hooks.get(event) ?? [], payload);
    expect(run('PreCompact', { trigger: 'manual' })).toBe('');
    const context = run('SessionStart', { source: 'compact' });
    expect(context).toContain(`the active feature is login (${LOGIN})`);
    expect(context).toContain('M src/greet.ts');
    expect(JSON.parse(run('Stop', { stop_hook_active: false }))).toMatchObject({ decision: 'block' });
    expect(run('Stop', { stop_hook_active: true })).toBe('');
  });
});

describe('init with the feature-memory module', () => {
  it("keeps a project's own mistakes log and memory template byte for byte, with no sidecar", async () => {
    const { dir } = fixtureCopy('ts-app');
    const own = { [MISTAKES]: '# Lessons\r\n', [TEMPLATE]: '# Our feature notes\n' };
    writeFiles(dir, own);
    const result = await runInit(dir, ['--yes', '--preset', 'small']);
    expect(result.code).toBe(0);
    for (const [file, text] of Object.entries(own)) {
      expect(read(dir, file)).toBe(text);
      expect(existsSync(path.join(dir, `${file}${TEST_BRAND.sidecarSuffix}`))).toBe(false);
    }
  });

  it('never touches the memory template or the mistakes log again once the user edits them', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes', '--preset', 'small']);
    writeFiles(dir, {
      [MISTAKES]: `${read(dir, MISTAKES)}\n- 2026-10-17: a lesson\n`,
      [TEMPLATE]: '# Ours\n',
    });
    const before = projectText(dir);
    const again = await runInit(dir, ['--yes']);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('Nothing to change');
    expect(projectText(dir)).toBe(before);
  });
});
