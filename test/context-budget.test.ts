import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import budgets from '../budgets.json' with { type: 'json' };
import { alwaysOnContext, importsOf } from '../scripts/context-rules.mjs';
import { fixtureCopy, runScript, tempDir, writeFiles } from './helpers.js';
import { existingClaudeSetup, KIT, runInit } from './init-helpers.js';

const BUDGETS = new Map(
  Object.entries(budgets.alwaysOnContext).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  ),
);

describe('alwaysOnContext', () => {
  it('counts CLAUDE.md and the project files it imports once, without markers, code spans or outside files', () => {
    const dir = tempDir();
    writeFiles(dir, {
      'CLAUDE.md':
        '<!-- kit:begin a -->\n@AGENTS.md\n<!-- kit:end a -->\nSee `@docs/skip.md` and @../outside.md\n',
      'AGENTS.md': 'Rules.\n@docs/more.md\n@CLAUDE.md\n',
      'docs/more.md': 'More.\n',
      'docs/skip.md': 'Not imported, it sits in a code span.\n',
    });
    const claude = '@AGENTS.md\nSee `@docs/skip.md` and @../outside.md\n'.length;
    const agents = 'Rules.\n@docs/more.md\n@CLAUDE.md\n'.length;
    expect(alwaysOnContext(dir, 0).instructions).toBe(claude + agents + 'More.\n'.length);
  });

  it('reads the imports of a file within 4 MiB on disk whose bytes that are not UTF-8 decode longer', () => {
    const dir = tempDir();
    const head = Buffer.from('@AGENTS.md\n\n');
    const claude = Buffer.concat([
      head,
      Buffer.alloc(8, 0xff),
      Buffer.alloc(4_194_295 - head.length - 8, 'a'),
    ]);
    writeFiles(dir, { 'AGENTS.md': 'Rules.\n' });
    writeFileSync(path.join(dir, 'CLAUDE.md'), claude);
    expect(alwaysOnContext(dir, 0).instructions).toBe(claude.toString('utf8').length + 'Rules.\n'.length);
  });

  it('counts rules without paths and the descriptions of skills Claude may invoke', () => {
    const dir = tempDir();
    writeFiles(dir, {
      'CLAUDE.md': '',
      '.claude/rules/kit/always.md': 'Always.\n',
      '.claude/rules/kit/python.md': '---\npaths:\n  - "**/*.py"\n---\nPython only.\n',
      '.claude/skills/why/SKILL.md':
        '---\nname: why\ndescription: "Explain a decision."\n---\n\nLong body.\n',
      '.claude/skills/handoff/SKILL.md':
        '---\ndescription: Save progress.\ndisable-model-invocation: true\n---\n',
    });
    const measured = alwaysOnContext(dir, 0);
    expect(measured.rules).toBe('Always.\n'.length);
    expect(measured.skills).toBe('Explain a decision.'.length);
  });

  it('reads imports after a space or an emphasis opener, but not after a bracket, in a word, a code span or a fence', () => {
    const text =
      'See **@AGENTS.md** and @docs/a\\ b.md now, not (@c.md), ada@example.com or `@x.md`.\n```\n@y.md\n```\n';
    expect(importsOf(text)).toEqual(['AGENTS.md', 'docs/a b.md']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails rather than count a file it cannot read as empty',
    () => {
      const dir = tempDir();
      writeFiles(dir, { 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'Rules.\n' });
      chmodSync(path.join(dir, 'AGENTS.md'), 0o000);
      onTestFinished(() => {
        chmodSync(path.join(dir, 'AGENTS.md'), 0o644);
      });
      expect(() => alwaysOnContext(dir, 0)).toThrow(/EACCES/);
    },
  );

  it('counts nothing for a block comment that spans lines, but keeps a comment that starts mid-line', () => {
    const dir = tempDir();
    writeFiles(dir, { 'CLAUDE.md': 'Kept.\n<!-- a note\nover two lines -->\nAlso <!-- inline --> kept.\n' });
    expect(alwaysOnContext(dir, 0).instructions).toBe('Kept.\nAlso <!-- inline --> kept.\n'.length);
  });

  it('adds the SessionStart cap and rounds tokens up from characters / 4', () => {
    const dir = tempDir();
    writeFiles(dir, { 'CLAUDE.md': 'abcde' });
    expect(alwaysOnContext(dir, 1200)).toMatchObject({ chars: 1205, tokens: 302 });
  });
});

describe('the always-on context budget (ADR-0017)', () => {
  it('starts at 1.5k, 3k and 4.5k tokens for small, medium and full', () => {
    expect(Object.fromEntries(BUDGETS)).toEqual({ small: 1500, medium: 3000, full: 4500 });
  });

  const cases = KIT.presets.flatMap((preset) =>
    ['ts-app', 'py-app', 'mixed', 'existing-claude-setup'].map((fixture) => [preset.name, fixture] as const),
  );
  it.each(cases)(
    'keeps %s on %s within budgets.json, SessionStart counted at its cap',
    async (name, fixture) => {
      const dir = fixture === 'existing-claude-setup' ? existingClaudeSetup() : fixtureCopy(fixture).dir;
      expect((await runInit(dir, ['--yes', '--preset', name])).code).toBe(0);
      const cap = KIT.presets.find((preset) => preset.name === name)?.defaults.sessionStartCap ?? Infinity;
      expect(alwaysOnContext(dir, cap).tokens).toBeLessThanOrEqual(BUDGETS.get(name) ?? 0);
    },
  );

  it('has a budget for every preset', () => {
    expect(KIT.presets.map((preset) => typeof BUDGETS.get(preset.name))).not.toContain('undefined');
  });

  it('is checked on the built CLI by scripts/context-budget.mjs, which needs a build first', () => {
    const result = runScript('scripts/context-budget.mjs', { cwd: tempDir() });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/cli.mjs is missing. Run npm run build first.');
  });
});
