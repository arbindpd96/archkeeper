import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { REPO_ROOT, fixtureCopy, runScript, tempRepo, withEnv } from './helpers.js';

const EXAMPLES = path.join(REPO_ROOT, 'examples');
const TS_FILES = [
  'package.json',
  'tsconfig.json',
  '.prettierrc.json',
  'eslint.config.js',
  'vitest.config.ts',
];
const TS_TOOLS = ['typescript', 'prettier', 'eslint', 'vitest'];

function read(fixture: string, file: string): string {
  return readFileSync(path.join(EXAMPLES, fixture, file), 'utf8');
}

function devDependencies(fixture: string): string[] {
  const manifest = JSON.parse(read(fixture, 'package.json')) as { devDependencies?: Record<string, string> };
  return Object.keys(manifest.devDependencies ?? {});
}

function dependencyGroups(fixture: string): string {
  const sections = read(fixture, 'pyproject.toml').split(/^\[/m);
  return sections.find((section) => section.startsWith('dependency-groups]')) ?? '';
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
}

describe('examples', () => {
  it.each(['ts-app', 'mixed'])(
    '%s carries the TS/JS signals: tsconfig, Prettier, ESLint and Vitest',
    (fixture) => {
      for (const file of TS_FILES) expect(existsSync(path.join(EXAMPLES, fixture, file)), file).toBe(true);
      expect(devDependencies(fixture)).toEqual(expect.arrayContaining(TS_TOOLS));
    },
  );

  it.each(['py-app', 'mixed'])('%s declares ruff and pytest under [dependency-groups]', (fixture) => {
    const groups = dependencyGroups(fixture);
    expect(groups).toContain('ruff');
    expect(groups).toContain('pytest');
  });

  it('keeps every fixture out of ESLint and Prettier', async () => {
    // Without an explicit config file, ESLint 10 lints each fixture with its own eslint.config.js.
    const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfigFile: 'eslint.config.mjs' });
    for (const file of filesUnder(EXAMPLES)) {
      expect(await eslint.isPathIgnored(file), file).toBe(true);
      const info = await getFileInfo(path.join(REPO_ROOT, file), { ignorePath: '.prettierignore' });
      expect(info.ignored, file).toBe(true);
    }
  });

  it('keeps every fixture out of the published package', () => {
    const published = readFileSync(path.join(REPO_ROOT, 'scripts/package-files.txt'), 'utf8');
    expect(published).not.toMatch(/^examples\//m);
  });

  it('keeps fixtures out of the comment check', () => {
    const repo = tempRepo({ 'examples/app/index.ts': '// export const old = 1;\nexport const a = 1;\n' });
    expect(runScript('scripts/check-comments.mjs', { cwd: repo }).status).toBe(0);
    writeFileSync(path.join(repo, 'index.ts'), '// export const old = 1;\nexport const a = 1;\n');
    expect(runScript('scripts/check-comments.mjs', { cwd: repo }).stderr).toContain('commented-out code');
  });
});

describe('withEnv', () => {
  it('lets an override replace a variable whose name differs only in case', () => {
    vi.stubEnv('R2_CASE_PROBE', 'from the parent');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const env = withEnv({ r2_case_probe: 'override' });
    const names = Object.keys(env).filter((name) => name.toLowerCase() === 'r2_case_probe');
    expect(names).toEqual(['r2_case_probe']);
    expect(env.r2_case_probe).toBe('override');
  });
});

describe('fixtureCopy', () => {
  it('copies a fixture under a path with a space and non-ASCII characters', () => {
    const { dir } = fixtureCopy('ts-app');
    expect(dir).toContain(' ');
    expect(dir).toMatch(/[^ -~]/u);
    expect(readFileSync(path.join(dir, 'package.json'), 'utf8')).toBe(read('ts-app', 'package.json'));
    writeFileSync(path.join(dir, 'package.json'), '{}\n');
    expect(read('ts-app', 'package.json')).not.toBe('{}\n');
  });

  it('isolates HOME and the git identity from the developer machine', () => {
    const { dir, env } = fixtureCopy('py-app');
    expect(env.HOME).not.toBe(homedir());
    expect(env.HOME?.startsWith(path.dirname(path.dirname(dir)))).toBe(true);
    execFileSync('git', ['init', '-q'], { cwd: dir, env });
    const email = execFileSync('git', ['config', 'user.email'], { cwd: dir, env, encoding: 'utf8' });
    expect(email.trim()).toBe('test@example.com');
  });

  it('names the examples folder when the fixture does not exist', () => {
    expect(() => fixtureCopy('missing')).toThrow('No fixture examples/missing');
  });
});
