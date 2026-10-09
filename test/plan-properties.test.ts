import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK, parseBlocks } from '../src/core/blocks-file.js';
import { readLock } from '../src/core/lock.js';
import { planInstall } from '../src/core/plan.js';
import type { PathState } from '../src/core/plan-types.js';
import type { RenderTree } from '../src/core/render-tree.js';
import {
  applied,
  blockEntry,
  CONTEXT,
  denyEntry,
  fileEntry,
  snapshotOf,
  TEST_BRAND,
  TEST_KIT,
  textAt,
  treeOf,
} from './plan-fixtures.js';

const RULES = ['Read(**/.env)', 'Bash(rm -rf:*)', 'Bash(git push --force:*)', 'Read(**/.env.*)'];
const text = fc
  .array(fc.stringMatching(/^[A-Za-z0-9 .,#-]{0,24}$/), { maxLength: 4 })
  .map((lines) => lines.map((line) => `${line}\n`).join(''));
const rules = fc.subarray(RULES);

/** A kit version: an owned file, a create-only file, up to three blocks and some deny rules. */
const kitVersion = fc.record({
  owned: text,
  createOnly: text,
  blocks: fc.uniqueArray(fc.tuple(fc.constantFrom('one', 'two', 'three'), text), {
    maxLength: 3,
    selector: ([id]) => id,
  }),
  deny: rules,
});
type KitVersion = typeof kitVersion extends fc.Arbitrary<infer T> ? T : never;

function treeFor(kit: KitVersion): RenderTree {
  return treeOf(
    ['rule.md', fileEntry(kit.owned)],
    ['notes.md', fileEntry(kit.createOnly, 'create-only')],
    ...kit.blocks.map(([id, body]) => ['AGENTS.md', blockEntry(id, body)] as const),
    ...(kit.deny.length > 0 ? [['.claude/settings.json', denyEntry(kit.deny)] as const] : []),
  );
}

/** What a project holds before the first install: for each kit path, nothing, the kit's own bytes, or user bytes. */
const existing = fc.record({
  owned: fc.option(text),
  createOnly: fc.option(text),
  agents: fc.option(text),
  settings: fc.option(fc.record({ model: fc.constantFrom('opus', 'sonnet'), deny: rules })),
});

function projectFor(
  kit: KitVersion,
  found: typeof existing extends fc.Arbitrary<infer T> ? T : never,
): Map<string, PathState> {
  const files: Record<string, string> = {};
  if (found.owned !== null) files['rule.md'] = found.owned === '' ? kit.owned : found.owned;
  if (found.createOnly !== null) files['notes.md'] = found.createOnly;
  if (found.agents !== null) files['AGENTS.md'] = found.agents;
  if (found.settings !== null) {
    files['.claude/settings.json'] =
      `${JSON.stringify({ model: found.settings.model, permissions: { deny: found.settings.deny } }, null, 2)}\n`;
  }
  return snapshotOf(files);
}

describe('planning against the state the previous apply left (#21)', () => {
  it('yields only skip operations and writes nothing', () => {
    fc.assert(
      fc.property(kitVersion, existing, (kit, found) => {
        const tree = treeFor(kit);
        const project = projectFor(kit, found);
        const first = planInstall(tree, project, undefined, CONTEXT);
        const read = readLock(first.lockText, TEST_KIT, TEST_BRAND);
        if (read.conflicted) throw new Error('the lock text holds conflict markers');
        const second = planInstall(tree, applied(project, first), read.lock, CONTEXT);
        expect(second.ops.filter((op) => op.kind !== 'skip')).toEqual([]);
        expect(second.writes.size).toBe(0);
        expect(second.lockText).toBe(first.lockText);
      }),
      { numRuns: 500 },
    );
  });
});

const userLine = fc
  .tuple(fc.nat(9999), fc.stringMatching(/^[a-z ]{0,12}$/))
  .map(([number, words]) => `user-${String(number)}: ${words}`);

function userLines(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => line.includes('user-'));
}

// Inserts lines between the parts of a blocks file, which is always outside every managed region.
function withUserLines(
  content: string,
  inserts: readonly (readonly [number, string])[],
  eol: string,
): string {
  const file = parseBlocks('AGENTS.md', content, TEST_BRAND);
  const pieces = file.parts.map((part) =>
    part.kind === 'text' ? part.text : `${part.begin}${part.body}${part.end}`,
  );
  for (const [at, line] of inserts) pieces.splice(at % (pieces.length + 1), 0, `${line}${eol}`);
  return (file.bom ? BYTE_ORDER_MARK : '') + pieces.join('');
}

function withEditedBlock(content: string, id: string, line: string): string {
  return content.replace(
    new RegExp(`(<!-- acmekit:begin ${id} -->\\r?\\n)[\\s\\S]*?(<!-- acmekit:end ${id} -->)`),
    `$1${line}\n$2`,
  );
}

const scenario = fc.record({
  v1: kitVersion,
  v2: kitVersion,
  initial: fc.array(userLine, { maxLength: 4 }),
  inserts: fc.array(fc.tuple(fc.nat(), userLine), { maxLength: 5 }),
  crlf: fc.boolean(),
  editBlock: fc.option(userLine),
  ownedEdit: fc.option(userLine),
  userRule: fc.option(userLine.map((line) => `Read(${line})`)),
});
type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

function userProject({ initial, crlf, userRule }: Scenario): Map<string, PathState> {
  const eol = crlf ? '\r\n' : '\n';
  const agents = initial.length > 0 ? { 'AGENTS.md': initial.map((line) => `${line}${eol}`).join('') } : {};
  const settings = { model: 'opus', permissions: { deny: userRule === null ? [] : [userRule] } };
  return snapshotOf({ ...agents, '.claude/settings.json': JSON.stringify(settings) });
}

// The user adds lines around the blocks, may rewrite the first block and may rewrite the owned file.
function userEdits(installed: ReadonlyMap<string, PathState>, run: Scenario): Map<string, PathState> {
  const edited = new Map(installed);
  const agents = installed.get('AGENTS.md');
  if (agents?.kind === 'file') {
    let content = withUserLines(agents.content, run.inserts, run.crlf ? '\r\n' : '\n');
    const [first] = run.v1.blocks;
    if (run.editBlock !== null && first !== undefined) {
      content = withEditedBlock(content, first[0], run.editBlock);
    }
    edited.set('AGENTS.md', { kind: 'file', content });
  }
  if (run.ownedEdit !== null) edited.set('rule.md', { kind: 'file', content: `${run.ownedEdit}\n` });
  return edited;
}

describe('user edits through a kit update (#22)', () => {
  it('keep every user-authored line, in order, in blocks, owned and JSON files', () => {
    fc.assert(
      fc.property(scenario, (run) => {
        const start = userProject(run);
        const first = planInstall(treeFor(run.v1), start, undefined, CONTEXT);
        const edited = userEdits(applied(start, first), run);
        const second = planInstall(treeFor(run.v2), edited, first.lock, CONTEXT);
        const final = applied(edited, second);
        if (edited.has('AGENTS.md')) {
          expect(userLines(textAt(final, 'AGENTS.md'))).toEqual(userLines(textAt(edited, 'AGENTS.md')));
        }
        if (run.ownedEdit !== null) expect(textAt(final, 'rule.md')).toBe(`${run.ownedEdit}\n`);
        const settings = JSON.parse(textAt(final, '.claude/settings.json')) as {
          model: string;
          permissions: { deny: string[] };
        };
        expect(settings.model).toBe('opus');
        if (run.userRule !== null) expect(settings.permissions.deny).toContain(run.userRule);
      }),
      { numRuns: 1000 },
    );
  });
});
