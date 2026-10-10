import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureCopy } from './helpers.js';
import { projectText } from './install-helpers.js';
import { runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const CONFIG = `${TEST_BRAND.stateDir}/config.json`;
const LOCK = `${TEST_BRAND.stateDir}/lock.json`;

function read(dir: string, file: string): string {
  return readFileSync(path.join(dir, file), 'utf8');
}

describe('init writes nothing without a yes', () => {
  it('needs --yes when a newer kit would only rewrite the lock', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes']);
    const lock = read(dir, LOCK);
    const upgraded = await runInit(dir, [], { version: '1.1.0' });
    expect(upgraded.code).toBe(1);
    expect(upgraded.stderr).toContain('pass --yes to apply the plan');
    expect(read(dir, LOCK)).toBe(lock);
    expect(upgraded.stdout).toContain('the lock and base blobs');
  });

  it('needs --yes when a re-run would only restore a deleted base blob', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes']);
    const blobs = path.join(dir, TEST_BRAND.stateDir, 'base');
    const [blob = ''] = readdirSync(blobs);
    rmSync(path.join(blobs, blob));
    const again = await runInit(dir);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('pass --yes to apply the plan');
    expect(existsSync(path.join(blobs, blob))).toBe(false);
  });

  it('asks nothing, about git or a yes, when a re-run has nothing to write', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes']);
    const again = await runInit(dir, [], { git: 'dirty' });
    expect(again.code).toBe(0);
    expect(again.stderr).toBe('');
    expect(again.stdout).toContain('Nothing to change');
  });

  it.each([
    ['ignored', 'is ignored by its git repository', 'stop ignoring it and commit it first, or pass --yes'],
    ['filters', 'sets a filter program', 'check the filter entries in its .git/config, or pass --yes'],
  ] as const)('stops on a folder git says is %s, naming the fix', async (git, problem, fix) => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, [], { git });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(problem);
    expect(result.stderr).toContain(`Try: ${fix}`);
  });
});

describe('init and a config edited while it waits', () => {
  it('refuses the plan it showed, writing no file and keeping the edit', async () => {
    const { dir } = fixtureCopy('ts-app');
    await runInit(dir, ['--yes', '--preset', 'small']);
    const edited = '{ "preset": "full" }\n';
    const whileAsking = (question: string): void => {
      if (question === 'Apply this plan?') writeFileSync(path.join(dir, CONFIG), edited);
    };
    const before = projectText(dir).replace(read(dir, CONFIG), edited);
    const answers = [true];
    const result = await runInit(dir, ['--preset', 'medium'], { interactive: true, answers, whileAsking });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('config.json');
    expect(read(dir, CONFIG)).toBe(edited);
    expect(projectText(dir)).toBe(before);
  });

  it('writes the config in the same transaction as the files, so a fresh init leaves both or neither', async () => {
    const { dir } = fixtureCopy('ts-app');
    const whileAsking = (question: string): void => {
      if (question === 'Apply this plan?') writeFileSync(path.join(dir, 'AGENTS.md'), '# Mine\n');
    };
    const result = await runInit(dir, [], { interactive: true, answers: ['medium', true], whileAsking });
    expect(result.code).toBe(1);
    expect(existsSync(path.join(dir, CONFIG))).toBe(false);
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
  });
});

describe('init with the safety guards left out', () => {
  it('warns and, on a terminal, asks before going on, writing nothing on a no', async () => {
    const { dir } = fixtureCopy('ts-app');
    const args = ['--preset', 'medium', '--modules', '-safety'];
    const result = await runInit(dir, args, { interactive: true, answers: [false] });
    expect(result.stderr).toContain('leaves out safety');
    expect(result.asked).toEqual(['Continue without safety?']);
    expect(result.code).toBe(1);
    expect(existsSync(path.join(dir, CONFIG))).toBe(false);
  });

  it('warns and goes on with --yes', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes', '--modules', '-safety']);
    expect(result.stderr).toContain('leaves out safety');
    expect(result.code).toBe(0);
  });
});

describe('init and the folders above every project', () => {
  it('refuses the home folder, where CLAUDE.md would load in every project, and writes nothing', async () => {
    const { dir } = fixtureCopy('ts-app');
    const result = await runInit(dir, ['--yes'], { home: dir });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is your home folder');
    expect(existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('refuses a file system root before reading anything there', async () => {
    const root = path.parse(fixtureCopy('ts-app').dir).root;
    const result = await runInit(root, ['--yes']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is a file system root');
  });
});
