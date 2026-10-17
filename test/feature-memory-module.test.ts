import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureCopy, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { moduleContent, moduleEntries, renderedKit, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';
import { frontmatterOf } from './static-rules.js';

const TEMPLATE = 'docs/features/_template/MEMORY.md';
const MISTAKES = 'docs/mistakes.md';
const POINTER = `${TEST_BRAND.stateDir}/local/active-feature`;
const TREE = renderedKit(['base', 'feature-memory']);

function written(file: string): string {
  return moduleContent(TREE, 'feature-memory', file);
}

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

describe('the feature-memory module (#34)', () => {
  it('writes the memory template and the mistakes log once, and owns its two skills and AGENTS.md block', () => {
    expect(moduleEntries(TREE, 'feature-memory')).toEqual([
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

  it('starts a feature only when the user asks, from the template, and points the active-feature file at it', () => {
    const skill = written('.claude/skills/new-feature/SKILL.md');
    expect(frontmatterOf(skill)?.get('disable-model-invocation')).toBe('true');
    expect(skill).toContain(`Copy \`${TEMPLATE}\` to \`docs/features/<name>/MEMORY.md\``);
    expect(skill).toContain(`write \`<name>\` as the only line of \`${POINTER}\``);
    expect(skill).toContain(
      `if \`${TEST_BRAND.stateDir}/local/.gitignore\` is missing, write it first with the single line \`*\``,
    );
  });

  it('lets Claude save progress on its own, to the feature the pointer names or the one in progress', () => {
    const skill = written('.claude/skills/handoff/SKILL.md');
    const fields = frontmatterOf(skill);
    expect(fields?.has('disable-model-invocation')).toBe(false);
    expect(fields?.get('description')).toMatch(
      /^Save this session's progress .* Use before ending a session/,
    );
    expect(skill).toContain(`the one named in \`${POINTER}\` when its \`docs/features/<name>/MEMORY.md\``);
    expect(skill).toContain('the only feature MEMORY.md that says so, leaving out folders whose names start');
    expect(skill).toContain(`add it to \`${MISTAKES}\``);
  });

  it('tells agents to keep the memory and the mistakes log, and how to start and save a feature', () => {
    const block = written('AGENTS.md');
    expect(block).toContain('`docs/features/<feature>/MEMORY.md`');
    expect(block).toContain('`/new-feature <name>`');
    expect(block).toContain('`/handoff`');
    expect(block).toContain(`\`${MISTAKES}\``);
    expect(block).toContain('Never contradict a recorded decision without asking the user first.');
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
