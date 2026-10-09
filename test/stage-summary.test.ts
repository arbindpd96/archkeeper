import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const STAGE_ID = '3f2c9a4e-8b1d-4c7e-9f00-1a2b3c4d5e6f';
const SHASUM = '0925379fa399bad13769b46f1add8107b1047c53';
const STAGED = { id: 'fixture-kit@1.2.0-rc.0', stageId: STAGE_ID, shasum: SHASUM };

function summarize(
  printed: unknown,
  args: string[] = ['--dist-tag', 'next', '--shasum', SHASUM],
): RunResult & { summary: string } {
  const dir = tempDir();
  writeFiles(dir, { 'stage.json': JSON.stringify(printed), 'summary.md': '' });
  const result = runScript('scripts/stage-summary.mjs', {
    args: [path.join(dir, 'stage.json'), ...args],
    env: { GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') },
  });
  return { ...result, summary: readFileSync(path.join(dir, 'summary.md'), 'utf8') };
}

describe('stage-summary', () => {
  it('prints the shasum to compare and the exact approve command', () => {
    const result = summarize({ 'fixture-kit': STAGED });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('### Staged `fixture-kit@1.2.0-rc.0` with dist-tag `next`');
    expect(result.stdout).toContain(`\`npm stage view ${STAGE_ID}\` shows shasum \`${SHASUM}\``);
    expect(result.stdout).toContain('`npm stage list` shows no other pending stage');
    expect(result.stdout).toContain(`npm stage approve ${STAGE_ID}\n`);
    expect(result.stdout).toContain(`npm stage reject ${STAGE_ID}`);
    expect(result.summary).toBe(result.stdout);
  });

  it('fails when npm staged a tarball other than the built one', () => {
    const result = summarize({ 'fixture-kit': { ...STAGED, shasum: 'f'.repeat(40) } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`not the built ${SHASUM}. Reject it.`);
    expect(result.summary).toBe('');
  });

  it('describes what a dry run would stage', () => {
    const printed = { 'fixture-kit': { id: 'fixture-kit@0.0.0' } };
    const result = summarize(printed, ['--dist-tag', 'latest', '--dry-run']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('npm would stage `fixture-kit@0.0.0` with dist-tag `latest`');
  });

  it('fails when npm printed no stage id, and points to npm stage list', () => {
    const result = summarize({ 'fixture-kit': { ...STAGED, stageId: 'not-a-uuid' } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('printed no stage id. Find it with npm stage list');
    expect(result.summary).toBe('');
  });

  it.each([[{}], [[]], [null], [{ a: { id: 'a@1' }, b: { id: 'b@1' } }], [{ x: { id: '`evil`' } }]])(
    'refuses output that is not one staged package: %j',
    (printed) => {
      const result = summarize(printed);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('is not the output of npm stage publish --json');
    },
  );

  it.each([
    [[]],
    [['stage.json']],
    [['stage.json', '--dist-tag', 'a b', '--shasum', SHASUM]],
    [['stage.json', '--dist-tag', 'next']],
    [['stage.json', '--dist-tag', 'next', '--shasum', 'abc']],
  ])('rejects arguments %j with usage', (args) => {
    const result = runScript('scripts/stage-summary.mjs', { args });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/stage-summary.mjs');
  });
});
