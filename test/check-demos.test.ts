import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gifBytes, REPO_ROOT, runScript, tempDir, writeFiles, type RunResult } from './helpers.js';

const FEATURE_TAPE = '# fixture: ts-app\nType "hello"\n';
const HERO_TAPE = '# hero\n# fixture: ts-app\nType "hello"\n';

interface Project {
  tapes?: Record<string, string>;
  modules?: Record<string, unknown>;
  readme?: string;
}

function checkDemos(gifs: Record<string, Buffer>, project: Project = {}): RunResult {
  const root = tempDir();
  const { tapes = {}, modules = {}, readme = '# Project\n' } = project;
  writeFiles(root, Object.fromEntries(Object.entries(tapes).map(([name, text]) => [`tapes/${name}`, text])));
  writeFiles(root, { 'README.md': readme });
  for (const [id, manifest] of Object.entries(modules)) {
    writeFiles(root, { [`modules/${id}/module.json`]: JSON.stringify(manifest) });
  }
  mkdirSync(path.join(root, 'media'), { recursive: true });
  for (const [name, bytes] of Object.entries(gifs)) writeFileSync(path.join(root, 'media', name), bytes);
  const args = ['--tapes', path.join(root, 'tapes'), '--modules', path.join(root, 'modules')];
  return runScript('scripts/check-demos.mjs', {
    args: [path.join(root, 'media'), ...args, '--readme', path.join(root, 'README.md')],
  });
}

describe('check-demos', () => {
  it('passes a feature GIF within 2 MB and 20 s and reports its size and duration', () => {
    const result = checkDemos(
      { 'init.gif': gifBytes([1000, 950]) },
      { tapes: { 'init.tape': FEATURE_TAPE } },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('| init | feature | 0.00 MB | 19.5 s |');
  });

  it('fails a feature GIF that runs over 20 s', () => {
    const result = checkDemos(
      { 'init.gif': gifBytes([1000, 1100]) },
      { tapes: { 'init.tape': FEATURE_TAPE } },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init.gif runs 21.0 s, over the 20 s feature cap.');
  });

  it('gives a tape marked # hero 30 s', () => {
    expect(checkDemos({ 'init.gif': gifBytes([3000]) }, { tapes: { 'init.tape': HERO_TAPE } }).status).toBe(
      0,
    );
    const result = checkDemos({ 'init.gif': gifBytes([3000, 100]) }, { tapes: { 'init.tape': HERO_TAPE } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init.gif runs 31.0 s, over the 30 s hero cap.');
  });

  it('fails a GIF over 2 MB', () => {
    const result = checkDemos(
      { 'init.gif': gifBytes([100], 2_000_000) },
      { tapes: { 'init.tape': FEATURE_TAPE } },
    );
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
    const result = checkDemos({ 'init.gif': bytes }, { tapes: { 'init.tape': FEATURE_TAPE } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('init.gif is not a valid GIF');
  });

  it('passes when there are no GIFs yet', () => {
    const root = tempDir();
    const args = [path.join(root, 'missing'), '--modules', path.join(root, 'modules')];
    const result = runScript('scripts/check-demos.mjs', { args });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no GIFs');
  });

  it('rejects more than one GIF folder with usage', () => {
    const result = runScript('scripts/check-demos.mjs', { args: ['a', 'b'] });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/check-demos.mjs');
  });
});

describe('check-demos module declarations', () => {
  const demo = { tape: 'init', section: 'Quick start' };
  const README = '# Project\n\n## Quick start\n\n![init](docs/media/init.gif)\n\n## Other\n';
  const complete: Project = {
    tapes: { 'init.tape': FEATURE_TAPE },
    modules: { base: { id: 'base', demo }, safety: { id: 'safety', internal: true } },
    readme: README,
  };

  it('passes internal modules and a demo with its tape, GIF and README section', () => {
    const result = checkDemos({ 'init.gif': gifBytes([100]) }, complete);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it.each<[string, Project, string]>([
    [
      'neither demo nor internal',
      { modules: { base: { id: 'base' } } },
      'module base declares neither demo nor internal',
    ],
    [
      'both demo and internal',
      { modules: { base: { id: 'base', demo, internal: true } } },
      'declares both demo and',
    ],
    [
      'a demo without its fields',
      { modules: { base: { id: 'base', demo: 'init' } } },
      'demo needs a tape and a README',
    ],
    ['a demo with no tape', { ...complete, tapes: {} }, 'module base demo "init" has no tape at'],
    [
      'a demo with no README heading',
      { ...complete, readme: '# Project\n' },
      'needs a "Quick start" heading',
    ],
    [
      'a README section that does not show the GIF',
      { ...complete, readme: '## Quick start\n\nRun it.\n\n## Other\n\n![init](docs/media/init.gif)\n' },
      'the "Quick start" section of',
    ],
  ])('fails a module with %s', (_name, project, message) => {
    const result = checkDemos({ 'init.gif': gifBytes([100]) }, project);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it('ignores # lines inside fenced code blocks when it finds the README section', () => {
    const readme =
      '# Project\n\n```bash\n# Quick start\n```\n\n## Quick start\n\n```bash\n# install it\nnpx kit\n```\n\n' +
      '![init](docs/media/init.gif)\n\n## Other\n';
    const result = checkDemos({ 'init.gif': gifBytes([100]) }, { ...complete, readme });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails a demo whose GIF is not committed', () => {
    const result = checkDemos({}, complete);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has no GIF at');
  });

  it('fails a manifest that is not valid JSON', () => {
    const root = tempDir();
    writeFiles(root, { 'modules/base/module.json': '{' });
    const args = [path.join(root, 'media'), '--modules', path.join(root, 'modules')];
    const result = runScript('scripts/check-demos.mjs', { args });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not valid JSON');
  });

  it("passes this repository's modules, which are internal until their milestone ships a demo", () => {
    const result = runScript('scripts/check-demos.mjs', { cwd: REPO_ROOT });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
