import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import { BRAND } from '../src/core/brand.js';
import { fixtureCopy, REPO_ROOT, withEnv, writeFiles } from './helpers.js';
import { moduleEntries, renderedKit, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';

const catalog = readKit(REPO_ROOT);
const manifest = catalog.modules.get('format-on-edit')?.manifest;
// A stand-in prettier that logs its arguments beside itself.
const PRETTIER =
  "require('node:fs').appendFileSync(__filename + '.log', JSON.stringify(process.argv.slice(2)) + '\\n');\n";

interface Handler {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeout: number;
}
interface Settings {
  readonly hooks: { readonly PostToolUse: readonly { matcher: string; hooks: readonly Handler[] }[] };
}

describe('the format-on-edit module (#37, ADR-0015)', () => {
  it('registers its hook after Edit, Write and MultiEdit with a 30-second timeout, where a formatter is found', () => {
    expect(
      manifest?.hooks.map(({ event, matcher, script, timeout }) => [event, matcher, script, timeout]),
    ).toEqual([['PostToolUse', 'Edit|Write|MultiEdit', 'dist/hooks/format-on-edit.mjs', 30]]);
    expect(manifest?.when).toEqual({ tools: ['prettier', 'biome', 'ruff'] });
    expect(manifest?.presets).toEqual(['medium', 'full']);
  });

  it('runs nothing the config does not record: every option starts empty', () => {
    const options = Object.entries(manifest?.options ?? {}).map(([name, spec]) => [
      name,
      spec.type,
      spec.default,
    ]);
    expect(options).toEqual([
      ['formatters', 'string-list', []],
      ['linters', 'string-list', []],
      ['commands', 'command-list', []],
    ]);
  });

  it('writes its bundle and its registration only, and no AGENTS.md block', () => {
    expect(moduleEntries(renderedKit(['base', 'format-on-edit']), 'format-on-edit')).toEqual([
      [`${TEST_BRAND.hookDir}/format-on-edit.mjs`, 'owned', ''],
      ['.claude/settings.json', 'json', ''],
    ]);
  });
});

describe('the installed format-on-edit hook, run as Claude Code runs it', () => {
  it('is the real bundle, under a path with a space, and formats with the prettier init recorded', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes'], { catalog })).code).toBe(0);
    // The real bundle reads the real brand's config, and init tests write the test brand's.
    const recorded = readFileSync(path.join(dir, TEST_BRAND.stateDir, 'config.json'), 'utf8');
    writeFiles(dir, {
      [`${BRAND.stateDir}/config.json`]: recorded,
      'node_modules/prettier/package.json': JSON.stringify({ bin: './bin/prettier.cjs' }),
      'node_modules/prettier/bin/prettier.cjs': PRETTIER,
    });
    const settings = parse(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')) as Settings;
    const group = settings.hooks.PostToolUse.find((entry) => entry.matcher === 'Edit|Write|MultiEdit');
    const handler = group?.hooks[0];
    expect(handler).toMatchObject({ command: 'node', timeout: 30 });
    const args = (handler?.args ?? []).map((arg) => arg.replace('${CLAUDE_PROJECT_DIR}', dir));
    expect(args[0]).toContain(' ');
    const payload = { tool_name: 'Edit', cwd: dir, tool_input: { file_path: 'src/greet.ts' } };
    const run = spawnSync(process.execPath, args, {
      cwd: dir,
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: withEnv({ CLAUDE_PROJECT_DIR: dir }),
    });
    expect(run.status).toBe(0);
    const log = readFileSync(path.join(dir, 'node_modules/prettier/bin/prettier.cjs.log'), 'utf8');
    const file = realpathSync.native(path.join(dir, 'src', 'greet.ts'));
    expect(log).toBe(`${JSON.stringify(['--write', '--ignore-unknown', '--log-level', 'warn', file])}\n`);
    expect(JSON.parse(run.stdout)).toMatchObject({
      systemMessage: expect.stringContaining('"eslint"') as string,
    });
  });
});
