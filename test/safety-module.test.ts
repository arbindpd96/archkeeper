import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import { REPO_ROOT, fixtureCopy, withEnv } from './helpers.js';
import { runInit } from './init-helpers.js';

const catalog = readKit(REPO_ROOT);
const safety = catalog.modules.get('safety')?.manifest;

interface Handler {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeout: number;
}
interface Settings {
  readonly hooks: { readonly PreToolUse: readonly { matcher: string; hooks: readonly Handler[] }[] };
}

describe('the safety module (#33, ADR-0015)', () => {
  it('writes the six deny rules, each owned by its exact string', () => {
    expect(safety?.permissions).toEqual({
      deny: [
        'Read(**/.env)',
        'Read(**/.env.*)',
        'Read(**/.envrc)',
        'Bash(rm -rf:*)',
        'Bash(git push --force:*)',
        'Bash(git push -f:*)',
      ],
    });
  });

  it('registers guard-bash on Bash and guard-secrets on every writing tool, each with a 10-second timeout', () => {
    expect(
      safety?.hooks.map(({ event, matcher, script, timeout }) => [event, matcher, script, timeout]),
    ).toEqual([
      ['PreToolUse', 'Bash', 'dist/hooks/guard-bash.mjs', 10],
      ['PreToolUse', 'Write|Edit|MultiEdit|NotebookEdit', 'dist/hooks/guard-secrets.mjs', 10],
    ]);
  });

  it('keeps every repo policy off by default', () => {
    const defaults = Object.fromEntries(
      Object.entries(safety?.options ?? {}).map(([name, spec]) => [name, spec.default]),
    );
    expect(defaults).toEqual({
      optOut: [],
      blockAiAttribution: false,
      blockNoVerify: false,
      denyCommands: [],
    });
  });

  it('tells agents what the deny rules cost and when they still apply', () => {
    const block = readFileSync(path.join(REPO_ROOT, 'modules/safety/files/agents-safety.md'), 'utf8');
    expect(block).toContain('still apply when a hook cannot run');
    expect(block).toContain('match on the command prefix only');
    expect(block).toContain('`Bash(rm -rf:*)` denies every command that starts with `rm -rf`, safe ones');
    expect(block).toContain('`Read(**/.env.*)` also blocks reading templates such as `.env.example`');
  });
});

describe('the installed guards, run as Claude Code runs them', () => {
  const PAYLOADS: readonly unknown[] = [
    { tool_name: 'Bash', tool_input: { command: 'git push origin main -f' } },
    { tool_name: 'Write', tool_input: { file_path: 'a.ts', content: `x = 'ghp_${'q'.repeat(36)}'` } },
  ];

  it('are the real bundles, under a path with a space, and deny through the registered command', async () => {
    const { dir } = fixtureCopy('ts-app');
    expect((await runInit(dir, ['--yes'], { catalog })).code).toBe(0);
    const settings = parse(readFileSync(path.join(dir, '.claude/settings.json'), 'utf8')) as Settings;
    for (const [index, group] of settings.hooks.PreToolUse.entries()) {
      const [handler] = group.hooks;
      expect(handler?.command).toBe('node');
      const args = (handler?.args ?? []).map((arg) => arg.replace('${CLAUDE_PROJECT_DIR}', dir));
      const script = args[0] ?? '';
      expect(script).toContain(' ');
      expect(readFileSync(script, 'utf8')).toBe(
        readFileSync(path.join(REPO_ROOT, 'dist/hooks', path.basename(script)), 'utf8'),
      );
      const run = spawnSync(process.execPath, args, {
        cwd: dir,
        input: JSON.stringify(PAYLOADS[index]),
        encoding: 'utf8',
        env: withEnv({ CLAUDE_PROJECT_DIR: dir }),
      });
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
  });
});
