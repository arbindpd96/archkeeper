import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gifBytes, runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const FEATURE_TAPE = '# fixture: ts-app\nType "hello"\n';
const HERO_TAPE = '# hero\n# fixture: ts-app\nType "hello"\n';

function checkDemos(gifs: Record<string, Buffer>, tapes: Record<string, string> = {}): RunResult {
  const root = tempDir();
  writeFiles(root, Object.fromEntries(Object.entries(tapes).map(([name, text]) => [`tapes/${name}`, text])));
  mkdirSync(path.join(root, 'media'), { recursive: true });
  for (const [name, bytes] of Object.entries(gifs)) writeFileSync(path.join(root, 'media', name), bytes);
  return runScript('scripts/check-demos.mjs', {
    args: [path.join(root, 'media'), '--tapes', path.join(root, 'tapes')],
  });
}

describe('check-demos', () => {
  it('passes a feature GIF within 2 MB and 20 s and reports its size and duration', () => {
    const result = checkDemos({ 'init.gif': gifBytes([1000, 950]) }, { 'init.tape': FEATURE_TAPE });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('| init | feature | 0.00 MB | 19.5 s |');
  });

  it('fails a feature GIF that runs over 20 s', () => {
    const result = checkDemos({ 'init.gif': gifBytes([1000, 1100]) }, { 'init.tape': FEATURE_TAPE });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init.gif runs 21.0 s, over the 20 s feature cap.');
  });

  it('gives a tape marked # hero 30 s', () => {
    expect(checkDemos({ 'init.gif': gifBytes([3000]) }, { 'init.tape': HERO_TAPE }).status).toBe(0);
    const result = checkDemos({ 'init.gif': gifBytes([3000, 100]) }, { 'init.tape': HERO_TAPE });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init.gif runs 31.0 s, over the 30 s hero cap.');
  });

  it('fails a GIF over 2 MB', () => {
    const result = checkDemos({ 'init.gif': gifBytes([100], 2_000_000) }, { 'init.tape': FEATURE_TAPE });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/init\.gif is \d+ bytes, over 2000000\./);
  });

  it('fails a GIF that no tape renders', () => {
    const result = checkDemos({ 'orphan.gif': gifBytes([100]) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('orphan.gif has no tape');
  });

  it.each([
    ['a file that is not a GIF', Buffer.from('PNG...')],
    ['a GIF cut off before its trailer', gifBytes([100]).subarray(0, 30)],
  ])('fails %s', (_name, bytes) => {
    const result = checkDemos({ 'init.gif': bytes }, { 'init.tape': FEATURE_TAPE });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init.gif is not a valid GIF');
  });

  it('passes when there are no GIFs yet', () => {
    const result = runScript('scripts/check-demos.mjs', { args: [path.join(tempDir(), 'missing')] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no GIFs');
  });

  it('rejects more than one GIF folder with usage', () => {
    const result = runScript('scripts/check-demos.mjs', { args: ['a', 'b'] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/check-demos.mjs');
  });
});
