import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/core/loader.js';
import { fixtureCopy } from './helpers.js';
import { projectText } from './install-helpers.js';
import { existingClaudeSetup as existingSetup, runInit, USER_SETUP } from './init-helpers.js';
import { kitFiles, memoryReader, plainManifest, TEST_BRAND } from './kit-fixtures.js';

const USER_CLAUDE = USER_SETUP['CLAUDE.md'];
const USER_AGENTS = USER_SETUP['AGENTS.md'];
const USER_SETTINGS = USER_SETUP['.claude/settings.json'];
const USER_SKILL = USER_SETUP['.claude/skills/why/SKILL.md'];

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

describe('init on a project with its own Claude Code setup', () => {
  it("keeps every user byte, adds the kit's blocks and does not import AGENTS.md twice", async () => {
    const dir = existingSetup();
    const result = await runInit(dir, ['--yes']);
    expect(result.code).toBe(0);
    const claude = read(dir, 'CLAUDE.md');
    expect(claude.startsWith(USER_CLAUDE)).toBe(true);
    expect(claude.match(/@AGENTS\.md/g)).toHaveLength(1);
    expect(claude).toContain(`\r\n<!-- ${TEST_BRAND.markerPrefix}:begin claude-code -->\r\n`);
    expect(read(dir, 'AGENTS.md').startsWith(`${USER_AGENTS}\n<!-- ${TEST_BRAND.markerPrefix}:begin`)).toBe(
      true,
    );
    expect(read(dir, '.claude/settings.json')).toBe(USER_SETTINGS);
    expect(read(dir, '.claude/skills/why/SKILL.md')).toBe(USER_SKILL);
  });

  it('changes nothing on a second run', async () => {
    const dir = existingSetup();
    await runInit(dir, ['--yes']);
    const before = projectText(dir);
    const again = await runInit(dir, ['--yes']);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('Nothing to change');
    expect(projectText(dir)).toBe(before);
  });
});

describe('init with a kit skill a user already has', () => {
  const skills = plainManifest('skills', {
    presets: ['small', 'medium', 'full'],
    files: [{ from: 'why.md', to: '.claude/skills/why/SKILL.md', strategy: 'owned', target: 'project' }],
  });
  const kitSkill =
    '---\nname: why\ndescription: Explain a past decision from docs/decisions.md.\n---\n\nSearch it.\n';
  const catalog = loadCatalog(
    ['skills'],
    memoryReader(kitFiles([skills], { 'modules/skills/files/why.md': kitSkill })),
  );

  it('writes a sidecar, reports the conflict and exits 2', async () => {
    const dir = existingSetup();
    const result = await runInit(dir, ['--yes'], { catalog });
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/conflict {2}\.claude\/skills\/why\/SKILL\.md: /);
    expect(result.stdout).toContain(`SKILL.md${TEST_BRAND.sidecarSuffix}`);
    expect(result.stdout).toContain(`${TEST_BRAND.stateDir}/lock.json`);
    expect(read(dir, '.claude/skills/why/SKILL.md')).toBe(USER_SKILL);
    expect(read(dir, `.claude/skills/why/SKILL.md${TEST_BRAND.sidecarSuffix}`)).toBe(kitSkill);
  });
});

describe('init on Windows-shaped projects', () => {
  it('runs from a path with a space and non-ASCII characters', async () => {
    const { dir } = fixtureCopy('py-app');
    expect(dir).toMatch(/ .*é/u);
    expect((await runInit(dir, ['--yes'])).code).toBe(0);
    expect(existsSync(path.join(dir, TEST_BRAND.stateDir, 'lock.json'))).toBe(true);
  });

  it('treats a root named in another case as the same project where the file system ignores case', async (context) => {
    const { dir } = fixtureCopy('ts-app');
    const shouted = path.join(path.dirname(dir), path.basename(dir).toUpperCase());
    if (!existsSync(shouted)) context.skip();
    expect((await runInit(dir, ['--yes'])).code).toBe(0);
    const before = projectText(dir);
    const again = await runInit(shouted, ['--yes']);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('Nothing to change');
    expect(projectText(dir)).toBe(before);
  });
});
