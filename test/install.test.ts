import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { install, planProject } from '../src/cli/install.js';
import { LockError } from '../src/core/errors.js';
import { readLock } from '../src/core/lock.js';
import { tempDir, writeFiles } from './helpers.js';
import { filesUnder, fixtureTree, OPTIONS, projectText } from './install-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const STATE = TEST_BRAND.stateDir;
const LOCK = `${STATE}/lock.json`;

const USER_SETTINGS = [
  '{',
  '  // Team settings, reviewed in PRs.',
  '  "model": "opus",',
  '  "permissions": {',
  '    "deny": ["Read(**/.env)"],',
  '  },',
  '}',
  '',
].join('\n');

function backups(dir: string): string[] {
  return readdirSync(path.join(dir, STATE, 'local/backup')).sort();
}

describe('install into a fresh project', () => {
  it('writes the rendered tree, the base blobs and the lock, as the snapshot shows', async () => {
    const dir = tempDir();
    const result = install(dir, fixtureTree(), OPTIONS);
    expect(result.applied.changed).toBe(true);
    await expect(projectText(dir)).toMatchFileSnapshot('__snapshots__/install-fresh.txt');
  });

  it('writes nothing on a second run, which plans only skips', () => {
    const dir = tempDir();
    install(dir, fixtureTree(), OPTIONS);
    const before = projectText(dir);
    const runs = backups(dir);
    const again = install(dir, fixtureTree(), OPTIONS);
    expect(again.applied).toEqual({ changed: false, warnings: [] });
    expect(again.plan.ops.filter((op) => op.kind !== 'skip')).toEqual([]);
    expect(projectText(dir)).toBe(before);
    expect(backups(dir)).toEqual(runs);
  });
});

describe('install on first contact with existing files', () => {
  function userProject(): string {
    const dir = tempDir();
    writeFiles(dir, {
      'CLAUDE.md': '# My project\r\n\r\nBuild with make.\r\n',
      'AGENTS.md': '# Agents\n\nBe kind.\n',
      '.claude/settings.json': USER_SETTINGS,
      '.claude/rules/acmekit/guard.md': 'My own guard rule.\n',
      '.claude/hooks/acmekit/guard.mjs': "export const guard = 'guard';\n",
      '.gitignore': 'node_modules/\n',
    });
    return dir;
  }

  it('adopts identical files, keeps different ones with a sidecar and merges blocks and JSON', async () => {
    const dir = userProject();
    install(dir, fixtureTree(), OPTIONS);
    await expect(projectText(dir)).toMatchFileSnapshot('__snapshots__/install-first-contact.txt');
  });

  it('records base null for a different file at an owned path and a pending sidecar', () => {
    const dir = userProject();
    const { plan } = install(dir, fixtureTree(), OPTIONS);
    expect(plan.lock.files.get('.claude/rules/acmekit/guard.md')).toMatchObject({ base: null });
    expect(plan.lock.files.get('.claude/rules/acmekit/guard.md')?.pending).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.lock.json.get('.claude/settings.json')?.has('permissions.deny Read(**/.env)')).toBe(false);
  });

  it('writes nothing on a second run', () => {
    const dir = userProject();
    install(dir, fixtureTree(), OPTIONS);
    const before = projectText(dir);
    expect(install(dir, fixtureTree(), OPTIONS).applied.changed).toBe(false);
    expect(projectText(dir)).toBe(before);
  });
});

describe('user deletions', () => {
  it('are recorded in removed[] and never recreated', () => {
    const dir = tempDir();
    install(dir, fixtureTree(), OPTIONS);
    rmSync(path.join(dir, '.claude/rules/acmekit/python.md'));
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Only mine now\n');
    const second = install(dir, fixtureTree(), OPTIONS);
    expect(second.plan.lock.removed).toEqual([
      { path: '.claude/rules/acmekit/python.md' },
      { path: 'AGENTS.md', blockId: 'guard' },
      { path: 'AGENTS.md', blockId: 'principles' },
    ]);
    expect(filesUnder(dir)).not.toContain('.claude/rules/acmekit/python.md');
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe('# Only mine now\n');
    expect(install(dir, fixtureTree(), OPTIONS).applied.changed).toBe(false);
  });
});

describe('the state folder', () => {
  it('holds nothing Claude Code would load as instructions or find in a search', () => {
    const dir = tempDir();
    writeFiles(dir, { 'AGENTS.md': '# Agents\n' });
    install(dir, fixtureTree(), OPTIONS);
    writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents, edited\n');
    install(dir, fixtureTree(), OPTIONS);
    const state = filesUnder(path.join(dir, STATE));
    expect(state.length).toBeGreaterThan(5);
    for (const file of state) {
      const name = path.basename(file).toLowerCase();
      expect(['claude.md', 'claude.local.md', 'agents.md', 'skill.md'], file).not.toContain(name);
      expect(file.split('/'), file).not.toContain('.claude');
      expect(name.endsWith('.md'), file).toBe(false);
    }
    const unique = 'Run shell scripts through the guard';
    expect(readFileSync(path.join(dir, '.claude/rules/acmekit/guard.md'), 'utf8')).toContain(unique);
    for (const file of state) {
      expect(readFileSync(path.join(dir, STATE, file)).includes(unique), file).toBe(false);
    }
  });

  it('ignores local/ with its own .gitignore and keeps backups private', () => {
    const dir = tempDir();
    writeFiles(dir, { 'AGENTS.md': '# Agents\n' });
    const { applied } = install(dir, fixtureTree(), OPTIONS);
    expect(readFileSync(path.join(dir, STATE, 'local/.gitignore'), 'utf8')).toBe('*\n');
    const run = path.join(dir, applied.backup ?? '');
    const manifest = JSON.parse(readFileSync(path.join(run, 'manifest.json'), 'utf8')) as {
      paths: Record<string, { type: string; blob?: string }>;
    };
    expect(manifest.paths['AGENTS.md']?.type).toBe('file');
    expect(manifest.paths['CLAUDE.md']).toEqual({ type: 'absent' });
    expect(manifest.paths[LOCK]).toEqual({ type: 'absent' });
    if (process.platform !== 'win32') {
      for (const name of readdirSync(run)) {
        expect(statSync(path.join(run, name)).mode & 0o777, name).toBe(0o600);
      }
      expect(statSync(run).mode & 0o777).toBe(0o700);
    }
  });

  it('keeps the last 3 backup runs', () => {
    const dir = tempDir();
    for (let run = 0; run < 5; run += 1) {
      writeFiles(dir, { 'AGENTS.md': `# Agents ${String(run)}\n` });
      rmSync(path.join(dir, LOCK), { force: true });
      install(dir, fixtureTree(), OPTIONS);
    }
    expect(backups(dir)).toHaveLength(3);
  });

  it('removes a base blob once no lock entry references it', () => {
    const dir = tempDir();
    const tree = fixtureTree();
    install(dir, tree, OPTIONS);
    const blobs = filesUnder(path.join(dir, STATE, 'base'));
    const smaller = new Map([...tree].filter(([file]) => file !== '.claude/skills/why/SKILL.md'));
    install(dir, smaller, { ...OPTIONS, ownable: () => true });
    const left = filesUnder(path.join(dir, STATE, 'base'));
    expect(left).toHaveLength(blobs.length - 1);
    expect(filesUnder(dir)).not.toContain('.claude/skills/why/SKILL.md');
  });
});

describe('the lock on disk', () => {
  it('refuses a lock from a newer lockfile version before writing anything', () => {
    const dir = tempDir();
    writeFiles(dir, { [LOCK]: '{ "lockfileVersion": 2 }\n' });
    expect(() => install(dir, fixtureTree(), OPTIONS)).toThrow(LockError);
    expect(filesUnder(dir)).toEqual([LOCK]);
  });

  it('rebuilds a lock left with conflict markers and writes it clean', () => {
    const dir = tempDir();
    install(dir, fixtureTree(), OPTIONS);
    const lock = readFileSync(path.join(dir, LOCK), 'utf8');
    writeFileSync(path.join(dir, LOCK), `<<<<<<< HEAD\n${lock}=======\n${lock}>>>>>>> other\n`);
    const plan = planProject(dir, fixtureTree(), OPTIONS);
    expect(plan.writes.size).toBe(0);
    install(dir, fixtureTree(), OPTIONS);
    expect(readFileSync(path.join(dir, LOCK), 'utf8')).toBe(lock);
    expect(readLock(lock, OPTIONS.kit, TEST_BRAND).conflicted).toBe(false);
  });

  it('reads files checked out with CRLF as unchanged', () => {
    const dir = tempDir();
    install(dir, fixtureTree(), OPTIONS);
    const rule = path.join(dir, '.claude/rules/acmekit/guard.md');
    writeFileSync(rule, readFileSync(rule, 'utf8').replaceAll('\n', '\r\n'));
    expect(install(dir, fixtureTree(), OPTIONS).applied.changed).toBe(false);
  });
});
