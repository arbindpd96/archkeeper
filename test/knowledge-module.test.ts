import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureCopy, writeFiles } from './helpers.js';
import { moduleContent, moduleEntries, renderedKit, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';
import { frontmatterOf } from './static-rules.js';

const DECISIONS = 'docs/decisions.md';
const ADR_TEMPLATE = 'docs/adr/0000-template.md';
const GLOSSARY = 'docs/glossary.md';
const TREE = renderedKit(['base', 'knowledge']);

function written(file: string): string {
  return moduleContent(TREE, 'knowledge', file);
}

function headings(text: string): string[] {
  return [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? '');
}

describe('the knowledge module (#34)', () => {
  it('writes the decision log, the ADR template and the glossary once, and owns its two skills and AGENTS.md block', () => {
    expect(moduleEntries(TREE, 'knowledge')).toEqual([
      ['.claude/skills/adr/SKILL.md', 'owned', ''],
      ['.claude/skills/why/SKILL.md', 'owned', ''],
      ['AGENTS.md', 'blocks', 'knowledge'],
      [ADR_TEMPLATE, 'create-only', ''],
      [DECISIONS, 'create-only', ''],
      [GLOSSARY, 'create-only', ''],
    ]);
  });

  it('gives each ADR a status, a date, deciders and the four sections of a decision record', () => {
    const template = written(ADR_TEMPLATE);
    expect(template).toContain(
      '- Status: proposed | accepted | superseded by ADR-XXXX\n- Date: YYYY-MM-DD\n',
    );
    expect(headings(template)).toEqual(['Context', 'Decision', 'Consequences', 'Alternatives considered']);
  });

  it('starts the decision log and the glossary with the empty tables the skills and the team fill in', () => {
    expect(written(DECISIONS)).toContain('| ADR | Decision | Status | Date |');
    expect(written(GLOSSARY)).toContain('| Term | Meaning |');
  });

  it('lets Claude answer why from the records on its own, the docs first and the commits last, citing path:line', () => {
    const skill = written('.claude/skills/why/SKILL.md');
    expect(frontmatterOf(skill)?.has('disable-model-invocation')).toBe(false);
    const sources = [
      `\`${DECISIONS}\` and the ADRs in \`docs/adr/\``,
      'the **Decisions** sections of `docs/features/*/MEMORY.md`',
      '`docs/mistakes.md`',
      '`git log --grep=<keyword> -i --oneline`',
    ];
    const positions = sources.map((source) => skill.indexOf(source));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(skill).toContain('Cite each source as `path:line`');
    expect(skill).toContain('skipping any that do not exist');
    expect(skill).toContain('If they do not answer it, search the commit history');
  });

  it('records an ADR only when the user asks, from the template, numbered and listed in the decision log', () => {
    const skill = written('.claude/skills/adr/SKILL.md');
    expect(frontmatterOf(skill)?.get('disable-model-invocation')).toBe('true');
    expect(skill).toContain(`Copy \`${ADR_TEMPLATE}\` to \`docs/adr/<NNNN>-<title>.md\``);
    expect(skill).toContain('written with four digits');
    expect(skill).toContain(`Add a row for it to the table in \`${DECISIONS}\``);
    expect(skill).toContain('Set `Status: accepted` only when the user has agreed to the decision');
  });

  it('tells agents where decisions and terms live, and to ask before contradicting an accepted ADR', () => {
    const block = written('AGENTS.md');
    for (const doc of [DECISIONS, 'docs/adr/', GLOSSARY, '/why <topic>', '/adr <title>']) {
      expect(block).toContain(`\`${doc}\``);
    }
    expect(block).toContain('Never contradict an accepted ADR without asking the user first.');
  });
});

describe('init with the knowledge module', () => {
  it("keeps a project's own decision log, ADR template and glossary byte for byte, with no sidecar", async () => {
    const { dir } = fixtureCopy('py-app');
    const own = {
      [DECISIONS]: '# Decisions\n',
      [ADR_TEMPLATE]: '# ADR template\r\n',
      [GLOSSARY]: '# Terms\n',
    };
    writeFiles(dir, own);
    expect((await runInit(dir, ['--yes', '--preset', 'medium'])).code).toBe(0);
    for (const [file, text] of Object.entries(own)) {
      expect(readFileSync(path.join(dir, file), 'utf8')).toBe(text);
      expect(existsSync(path.join(dir, `${file}${TEST_BRAND.sidecarSuffix}`))).toBe(false);
    }
  });

  it('writes nothing of its own with the small preset', async () => {
    const { dir } = fixtureCopy('py-app');
    expect((await runInit(dir, ['--yes', '--preset', 'small'])).code).toBe(0);
    for (const file of [DECISIONS, ADR_TEMPLATE, GLOSSARY, '.claude/skills/why', '.claude/skills/adr']) {
      expect(existsSync(path.join(dir, file)), file).toBe(false);
    }
  });
});
