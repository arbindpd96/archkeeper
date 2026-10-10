import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../src/core/loader.js';
import { memoryImports } from '../src/core/memory-imports.js';
import { BYTE_ORDER_MARK } from '../src/core/text.js';
import { canSymlink, fixtureCopy, tempDir, writeFiles } from './helpers.js';
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

describe('init on a CLAUDE.md that opens with YAML frontmatter', () => {
  const marker = (edge: string, id: string): string => `<!-- ${TEST_BRAND.markerPrefix}:${edge} ${id} -->`;

  it('imports AGENTS.md right after the frontmatter, with the byte-order mark and CRLF kept, once', async () => {
    const { dir } = fixtureCopy('ts-app');
    const frontmatter = `${BYTE_ORDER_MARK}---\r\nname: rules\r\n---\r\n`;
    writeFiles(dir, { 'CLAUDE.md': `${frontmatter}# Notes\r\n` });
    expect((await runInit(dir, ['--yes'])).code).toBe(0);
    const claude = read(dir, 'CLAUDE.md');
    const imports = `${marker('begin', 'agents-import')}\r\n@AGENTS.md\r\n${marker('end', 'agents-import')}\r\n`;
    expect(
      claude.startsWith(`${frontmatter}${imports}\r\n# Notes\r\n\r\n${marker('begin', 'claude-code')}\r\n`),
    ).toBe(true);
    expect(memoryImports(claude)).toEqual(['AGENTS.md']);
    expect(claude.match(/@AGENTS\.md/g)).toHaveLength(1);
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

  it('still exits 2 and names the sidecar on a re-run while it waits for review', async () => {
    const dir = existingSetup();
    await runInit(dir, ['--yes'], { catalog });
    const again = await runInit(dir, [], { catalog });
    expect(again.code).toBe(2);
    expect(again.stdout).toContain('sidecars still wait for review');
    expect(again.stdout).toContain(`.claude/skills/why/SKILL.md${TEST_BRAND.sidecarSuffix}`);
  });
});

describe('init beside a .claude folder linked elsewhere, as in a dotfiles setup', () => {
  it.skipIf(!canSymlink())('sets up the project without reading through the link', async () => {
    const { dir } = fixtureCopy('ts-app');
    const dotfiles = tempDir();
    writeFiles(dotfiles, { 'CLAUDE.md': 'Rules: @../AGENTS.md\n', 'settings.json': '{}\n' });
    symlinkSync(dotfiles, path.join(dir, '.claude'), 'dir');
    const result = await runInit(dir, ['--yes']);
    expect(result.code).toBe(0);
    expect(read(dir, 'CLAUDE.md')).toContain('@AGENTS.md');
  });
});

describe('init beside an AGENTS.md linked elsewhere', () => {
  it.skipIf(!canSymlink())(
    'imports no AGENTS.md linked to a file outside the project, and says so',
    async () => {
      const { dir } = fixtureCopy('ts-app');
      const outside = tempDir();
      writeFiles(outside, { 'private.md': 'not for the project\n' });
      symlinkSync(path.join(outside, 'private.md'), path.join(dir, 'AGENTS.md'));
      const result = await runInit(dir, ['--yes']);
      expect(read(dir, 'CLAUDE.md')).not.toContain('@AGENTS.md');
      expect(result.stderr).toContain('AGENTS.md resolves outside the project');
    },
  );

  it.skipIf(!canSymlink())(
    'imports no AGENTS.md linked to a private file inside the project, such as .env, and says so',
    async () => {
      const { dir } = fixtureCopy('ts-app');
      writeFiles(dir, { '.env': 'API_TOKEN=from-the-env-file\n' });
      symlinkSync('.env', path.join(dir, 'AGENTS.md'));
      const result = await runInit(dir, ['--yes']);
      expect(result.code).toBe(2);
      expect(read(dir, 'CLAUDE.md')).not.toContain('@AGENTS.md');
      expect(result.stderr).toContain('since AGENTS.md is a link');
      expect(read(dir, '.env')).toBe('API_TOKEN=from-the-env-file\n');
    },
  );
});

describe('init beside a CLAUDE.md linked to AGENTS.md', () => {
  it.skipIf(!canSymlink())(
    'leaves the links alone, adds the agent rules and keeps AGENTS.md from importing itself',
    async () => {
      const { dir } = fixtureCopy('ts-app');
      writeFiles(dir, { 'AGENTS.md': 'Shared rules.\n' });
      symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
      const result = await runInit(dir, ['--yes']);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('CLAUDE.md is a link to AGENTS.md, which it loads already');
      const agents = read(dir, 'AGENTS.md');
      expect(agents.startsWith('Shared rules.\n')).toBe(true);
      expect(agents).toContain(`<!-- ${TEST_BRAND.markerPrefix}:begin agent-rules -->`);
      const sidecar = read(dir, `CLAUDE.md${TEST_BRAND.sidecarSuffix}`);
      expect(sidecar).toContain(`<!-- ${TEST_BRAND.markerPrefix}:begin claude-code -->`);
      expect(sidecar).not.toContain('@AGENTS.md');
    },
  );
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
