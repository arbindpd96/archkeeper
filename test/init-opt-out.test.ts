import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { fixtureCopy, writeFiles } from './helpers.js';
import { projectText } from './install-helpers.js';
import { runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const SETTINGS = '.claude/settings.json';
const GUARD_BASH = `${TEST_BRAND.hookDir}/guard-bash.mjs`;
const WARNING = 'leaves out safety: Bash(rm -rf:*), safety: guard-bash';

interface Settings {
  readonly permissions?: { readonly deny?: readonly string[] };
  readonly hooks?: { readonly PreToolUse?: readonly unknown[] };
}

function settingsOf(dir: string): Settings {
  return parse(readFileSync(path.join(dir, SETTINGS), 'utf8')) as Settings;
}

function configWith(optOut: readonly string[]): string {
  return `${JSON.stringify({ version: 1, preset: 'small', options: { safety: { optOut } } }, null, 2)}\n`;
}

describe('init with the safety optOut option (#33, ADR-0014)', () => {
  it('writes neither an opted-out rule nor an opted-out guard, and warns the first time', async () => {
    const { dir } = fixtureCopy('ts-app');
    writeFiles(dir, { [CONFIG]: configWith(['Bash(rm -rf:*)', 'guard-bash']) });
    const result = await runInit(dir, ['--yes']);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(WARNING);
    expect(settingsOf(dir).permissions?.deny).not.toContain('Bash(rm -rf:*)');
    expect(settingsOf(dir).hooks?.PreToolUse).toHaveLength(1);
    expect(existsSync(path.join(dir, GUARD_BASH))).toBe(false);
  });

  it('does not warn again once the lock records the optOut, and changes nothing', async () => {
    const { dir } = fixtureCopy('ts-app');
    writeFiles(dir, { [CONFIG]: configWith(['Bash(rm -rf:*)']) });
    await runInit(dir, ['--yes']);
    const before = projectText(dir);
    const again = await runInit(dir, ['--yes']);
    expect(again.stderr).toBe('');
    expect(again.stdout).toContain('Nothing to change');
    expect(projectText(dir)).toBe(before);
  });

  it('removes the entries the kit wrote once the config opts out of them, warning once', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes', '--preset', 'small']);
    expect(settingsOf(dir).permissions?.deny).toContain('Bash(rm -rf:*)');
    writeFileSync(path.join(dir, CONFIG), configWith(['Bash(rm -rf:*)', 'guard-bash']));
    const opted = await runInit(dir, ['--yes']);
    expect(opted.stderr).toContain(WARNING);
    expect(settingsOf(dir).permissions?.deny).not.toContain('Bash(rm -rf:*)');
    expect(existsSync(path.join(dir, GUARD_BASH))).toBe(false);
    expect((await runInit(dir, ['--yes'])).stderr).toBe('');
  });

  it('keeps a rule the user changed, though the config opts out of it', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes', '--preset', 'small']);
    const file = path.join(dir, SETTINGS);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"Bash(rm -rf:*)"', '"Bash(rm -rf /:*)"'));
    writeFileSync(path.join(dir, CONFIG), configWith(['Bash(rm -rf:*)']));
    expect((await runInit(dir, ['--yes'])).code).toBe(0);
    expect(settingsOf(dir).permissions?.deny).toContain('Bash(rm -rf /:*)');
    const before = projectText(dir);
    const again = await runInit(dir, ['--yes']);
    expect(again.stderr).toBe('');
    expect(again.stdout).toContain('Nothing to change');
    expect(projectText(dir)).toBe(before);
  });

  it('keeps a guard registration the user changed, then neither warns nor asks again', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes', '--preset', 'small']);
    const file = path.join(dir, SETTINGS);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/(guard-bash\.mjs"[^}]*"timeout": )10/, '$130'));
    expect(readFileSync(file, 'utf8')).toContain('"timeout": 30');
    writeFileSync(path.join(dir, CONFIG), configWith(['guard-bash']));
    expect((await runInit(dir, ['--yes'])).stderr).toContain('leaves out safety: guard-bash');
    expect(readFileSync(file, 'utf8')).toContain('"timeout": 30');
    const before = projectText(dir);
    const again = await runInit(dir, [], { interactive: true, answers: [true] });
    expect(again.asked).not.toContain('Continue without safety: guard-bash?');
    expect(again.stderr).toBe('');
    expect(projectText(dir)).toBe(before);
  });

  it('asks on a terminal the first time, writing nothing on a no', async () => {
    const { dir } = fixtureCopy('ts-app');
    writeFiles(dir, { [CONFIG]: configWith(['guard-secrets']) });
    const result = await runInit(dir, [], { interactive: true, answers: [false] });
    expect(result.asked).toEqual(['Continue without safety: guard-secrets?']);
    expect(result.code).toBe(1);
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('warns about an entry that names no rule or guard of the module, with the names it takes', async () => {
    const { dir } = fixtureCopy('ts-app');
    writeFiles(dir, { [CONFIG]: configWith(['Bash(rm -rf *)']) });
    const result = await runInit(dir, ['--yes']);
    expect(result.stderr).toContain('options.safety.optOut: "Bash(rm -rf *)" names none of this module');
    expect(result.stderr).toContain('use one of: Read(**/.env), ');
    expect(settingsOf(dir).permissions?.deny).toContain('Bash(rm -rf:*)');
  });
});

describe('init with the safety module left out (#33)', () => {
  it('writes no settings, hook scripts or safety block', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes', '--modules', '-safety'])).code).toBe(0);
    expect(existsSync(path.join(dir, SETTINGS))).toBe(false);
    expect(existsSync(path.join(dir, TEST_BRAND.hookDir))).toBe(false);
    expect(readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).not.toContain('Safety guards');
  });
});
