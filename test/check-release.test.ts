import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const CHANGELOG = '# fixture-kit\n\n## 1.2.0\n\n### Minor Changes\n\n- Add init.\n\n## 1.1.0\n\n- Older.\n';

function project(manifest: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  const root = tempDir();
  writeFiles(root, {
    'package.json': JSON.stringify({
      name: 'fixture-kit',
      version: '1.2.0',
      bin: { 'fixture-kit': 'dist/cli.mjs' },
      ...manifest,
    }),
    'CHANGELOG.md': CHANGELOG,
    ...files,
  });
  return root;
}

function checkRelease(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): RunResult & { outputs: string } {
  const outputFile = path.join(tempDir(), 'github-output');
  writeFiles(path.dirname(outputFile), { 'github-output': '' });
  const result = runScript('scripts/check-release.mjs', {
    args,
    cwd: root,
    env: { GITHUB_OUTPUT: outputFile, GITHUB_ACTIONS: '', GITHUB_REF_NAME: '', ...env },
  });
  return { ...result, outputs: readFileSync(outputFile, 'utf8') };
}

function fakeNpm(version: string): NodeJS.ProcessEnv {
  const dir = tempDir();
  writeFiles(dir, { 'npm-cli.js': `process.stdout.write('${version}\\n');\n` });
  return { npm_execpath: path.join(dir, 'npm-cli.js') };
}

describe('check-release', () => {
  it('passes a tagged stable release and writes the facts later steps need', () => {
    const result = checkRelease(project(), ['--tag', 'v1.2.0']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready to stage fixture-kit@1.2.0 (dist-tag latest)');
    expect(result.outputs).toBe(
      'name=fixture-kit\nversion=1.2.0\nbin=fixture-kit\nprerelease=false\ndist-tag=latest\n',
    );
  });

  it('stages a prerelease under the next dist-tag', () => {
    const root = project({ version: '1.2.0-rc.0' }, { 'CHANGELOG.md': '## 1.2.0-rc.0\n\n- Try init.\n' });
    const result = checkRelease(root, ['--tag', 'v1.2.0-rc.0']);
    expect(result.status).toBe(0);
    expect(result.outputs).toContain('prerelease=true\ndist-tag=next\n');
  });

  it('takes the tag from GITHUB_REF_NAME on a tag push', () => {
    expect(checkRelease(project(), [], { GITHUB_REF_NAME: 'v1.2.0' }).status).toBe(0);
  });

  it.each([
    [
      'a tag that differs from the version',
      {},
      ['--tag', 'v1.3.0'],
      'Tag v1.3.0 does not match package.json version 1.2.0',
    ],
    ['no tag at all', {}, [], 'Tag (none) does not match'],
    ['a private package', { private: true }, ['--tag', 'v1.2.0'], '"private": true'],
    ['a version that is not a release', { version: 'next' }, ['--tag', 'vnext'], 'is not X.Y.Z'],
  ])('refuses %s', (_name, manifest, args, message) => {
    const result = checkRelease(project(manifest), args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.outputs).toBe('');
  });

  it('refuses a version without a CHANGELOG section and says how to add one', () => {
    const result = checkRelease(project({ version: '1.3.0' }), ['--tag', 'v1.3.0']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CHANGELOG.md has no "## 1.3.0" section. Run npm run version-packages');
  });

  it('refuses an npm too old for staged publishing', () => {
    const result = checkRelease(project(), ['--tag', 'v1.2.0'], fakeNpm('11.14.2'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm 11.14.2 is older than 11.15.0');
  });

  it('accepts npm 11.15 and newer majors', () => {
    expect(checkRelease(project(), ['--tag', 'v1.2.0'], fakeNpm('11.15.0')).status).toBe(0);
    expect(checkRelease(project(), ['--tag', 'v1.2.0'], fakeNpm('12.0.0')).status).toBe(0);
  });

  it('reports but does not enforce the tag, CHANGELOG and private guards in a dry run', () => {
    const root = project({ private: true, version: '0.0.0' }, { 'CHANGELOG.md': '' });
    const result = checkRelease(root, ['--dry-run'], { GITHUB_ACTIONS: 'true' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('::warning title=Release dry run::package.json is "private": true');
    expect(result.stdout).toContain(
      '::warning title=Release dry run::CHANGELOG.md has no "## 0.0.0" section',
    );
    expect(result.stdout).toContain('dry run passed; a release would stage fixture-kit@0.0.0');
    expect(result.outputs).toContain('dist-tag=latest');
  });

  it('still enforces the npm version in a dry run', () => {
    const result = checkRelease(project(), ['--dry-run'], fakeNpm('10.9.9'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm 10.9.9 is older');
  });

  it('writes the CHANGELOG section as release notes', () => {
    const notes = path.join(tempDir(), 'notes.md');
    expect(checkRelease(project(), ['--tag', 'v1.2.0', '--notes', notes]).status).toBe(0);
    expect(readFileSync(notes, 'utf8')).toBe('### Minor Changes\n\n- Add init.\n');
  });

  it('refuses a package name that would break the step outputs', () => {
    const result = checkRelease(project({ name: 'kit\nevil=1' }), ['--tag', 'v1.2.0']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unusable name');
    expect(result.outputs).toBe('');
  });

  it('rejects an unknown option with usage', () => {
    const result = checkRelease(project(), ['--publish']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/check-release.mjs');
  });
});
