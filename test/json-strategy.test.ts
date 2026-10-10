import { describe, expect, it } from 'vitest';
import { MergeError } from '../src/core/errors.js';
import { contentHash } from '../src/core/hash.js';
import { type JsonJob, planJson, SETTINGS_SCHEMA } from '../src/core/json-plan.js';
import type { PathState } from '../src/core/plan-types.js';
import type { RenderedEntry } from '../src/core/render-tree.js';
import { BYTE_ORDER_MARK, compareText } from '../src/core/text.js';
import { TEST_BRAND } from './kit-fixtures.js';

const SETTINGS = '.claude/settings.json';
const GUARD = '.claude/hooks/acmekit/guard.mjs';
const HOOK_KEY = `hooks.PreToolUse ${GUARD}`;
const hookGroup = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: 'node', args: [`\${CLAUDE_PROJECT_DIR}/${GUARD}`], timeout: 10 }],
};

const file = (content: string): PathState => ({ kind: 'file', content });
const hashOf = (value: unknown): string => contentHash(canonical(value));

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const entries = Object.entries(value).map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`);
  return `{${entries.sort(compareText).join(',')}}`;
}

function jsonEntry(value: unknown, keys: string[], module = 'm'): RenderedEntry {
  return {
    strategy: 'json',
    module,
    content: `${JSON.stringify(value, null, 2)}\n`,
    keys: [...keys].sort(compareText),
  };
}

const settingsEntry = jsonEntry(
  { hooks: { PreToolUse: [hookGroup] }, permissions: { deny: ['Read(**/.env)', 'Bash(rm -rf:*)'] } },
  [HOOK_KEY, 'permissions.deny Read(**/.env)', 'permissions.deny Bash(rm -rf:*)'],
);

function plan(
  job: Partial<Omit<JsonJob, 'lock'>> & { lock?: Record<string, string>; removed?: string[] } = {},
): ReturnType<typeof planJson> {
  const { lock, removed = [], ...rest } = job;
  return planJson({
    path: SETTINGS,
    entries: [settingsEntry],
    state: undefined,
    sidecar: undefined,
    lock: lock === undefined ? undefined : new Map(Object.entries(lock)),
    isRemoved: (key) => removed.includes(key),
    ownable: () => false,
    script: () => 'kit',
    brand: TEST_BRAND,
    ...rest,
  });
}

function written(outcome: ReturnType<typeof planJson>): string {
  if (typeof outcome.content !== 'string') throw new Error('nothing was written');
  return outcome.content;
}

describe('the json strategy', () => {
  it('creates settings.json with $schema first and the entries in render order', () => {
    const outcome = plan();
    const value = JSON.parse(written(outcome)) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['$schema', 'hooks', 'permissions']);
    expect(value).toEqual({
      $schema: SETTINGS_SCHEMA,
      hooks: { PreToolUse: [hookGroup] },
      permissions: { deny: ['Read(**/.env)', 'Bash(rm -rf:*)'] },
    });
    expect(written(outcome)).toMatch(/^\{\n {2}"\$schema"/);
    expect(outcome.ops.map((op) => op.entry)).toEqual([
      '$schema',
      HOOK_KEY,
      'permissions.deny Read(**/.env)',
      'permissions.deny Bash(rm -rf:*)',
    ]);
    expect(new Set(outcome.json?.keys())).toEqual(new Set(outcome.ops.map((op) => op.entry)));
    expect(outcome.json?.get('permissions.deny Read(**/.env)')).toBe(hashOf('Read(**/.env)'));
    expect(outcome.json?.get(HOOK_KEY)).toBe(hashOf(hookGroup));
  });

  it('merges into a user file without changing, reordering or losing its entries and comments', () => {
    const mine = [
      '{',
      '  // my settings',
      '  "model": "opus",',
      '  "permissions": {',
      '    "allow": ["Bash(npm test)"],',
      '    "deny": [',
      '      "Read(secrets/**)", /* keep */',
      '    ],',
      '  },',
      '}',
      '',
    ].join('\n');
    const result = written(plan({ state: file(mine) }));
    expect(result).toContain('// my settings');
    expect(result).toContain('/* keep */');
    expect(result.indexOf('"model"')).toBeLessThan(result.indexOf('"permissions"'));
    expect(result.indexOf('Read(secrets/**)')).toBeLessThan(result.indexOf('Read(**/.env)'));
    expect(result).toContain('"allow": ["Bash(npm test)"]');
    expect(result.split('\n')[1]).toBe(`  "$schema": "${SETTINGS_SCHEMA}",`);
  });

  it('keeps the indentation, line endings and byte-order mark the file uses', () => {
    const mine = `${BYTE_ORDER_MARK}{\r\n\t"model": "opus"\r\n}\r\n`;
    const result = written(plan({ state: file(mine) }));
    expect(result.startsWith(`${BYTE_ORDER_MARK}{\r\n\t"$schema"`)).toBe(true);
    expect(result).not.toMatch(/[^\r]\n/);
    expect(result).toContain('\t"model": "opus"');
  });

  it('leaves a $schema the user set, without owning it', () => {
    const outcome = plan({ state: file('{ "$schema": "./mine.json" }\n') });
    expect(written(outcome)).toContain('"$schema": "./mine.json"');
    expect(written(outcome)).not.toContain(SETTINGS_SCHEMA);
    expect(outcome.json?.has('$schema')).toBe(false);
  });

  it('leaves an entry the user already has under a kit key as theirs, never adding a copy', () => {
    const outcome = plan({ state: file('{ "permissions": { "deny": ["Read(**/.env)"] } }\n') });
    expect(outcome.ops.find((op) => op.entry === 'permissions.deny Read(**/.env)')).toMatchObject({
      kind: 'skip',
      reason: 'the user already has this entry, so it stays theirs',
    });
    expect(written(outcome).match(/Read\(\*\*\/\.env\)/g)).toHaveLength(1);
    expect(outcome.json?.has('permissions.deny Read(**/.env)')).toBe(false);
  });

  it('does not register a hook whose script the kit neither wrote nor adopted', () => {
    const outcome = plan({ script: (script) => (script === GUARD ? 'other' : 'kit') });
    expect(outcome.ops.find((op) => op.entry === HOOK_KEY)).toMatchObject({ kind: 'skip' });
    expect(written(outcome)).not.toContain('hooks');
    expect(outcome.json?.has(HOOK_KEY)).toBe(false);
  });

  it('adds no $schema to a file where the kit owns no other entry', () => {
    const hookOnly = jsonEntry({ hooks: { PreToolUse: [hookGroup] } }, [HOOK_KEY]);
    const outcome = plan({ entries: [hookOnly], script: () => 'other' });
    expect(outcome.content).toBeUndefined();
    expect(outcome.ops).toMatchObject([
      {
        kind: 'skip',
        entry: '$schema',
        reason: 'the kit owns no other entry in this file, so it adds no $schema',
      },
      { kind: 'skip', entry: HOOK_KEY },
    ]);
  });

  it('adds a kit hook next to a user hook on the same event', () => {
    const mine = {
      hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'mine.sh' }] }] },
    };
    const value = JSON.parse(written(plan({ state: file(JSON.stringify(mine)) }))) as {
      hooks: { PreToolUse: unknown[] };
    };
    expect(value.hooks.PreToolUse).toEqual([...mine.hooks.PreToolUse, hookGroup]);
  });

  it('updates a kit entry unchanged since the kit wrote it, and nothing else', () => {
    const old = { type: 'http', url: 'https://old.example.com/mcp' };
    const next = { type: 'http', url: 'https://example.com/mcp' };
    const mine = { mcpServers: { mine: { type: 'stdio', command: 'x' }, docs: old } };
    const outcome = plan({
      path: '.mcp.json',
      entries: [jsonEntry({ mcpServers: { docs: next } }, ['mcpServers docs'])],
      state: file(`${JSON.stringify(mine, null, 2)}\n`),
      lock: { 'mcpServers docs': hashOf(old) },
    });
    expect(outcome.ops).toMatchObject([{ kind: 'mergeJson', entry: 'mcpServers docs' }]);
    expect(JSON.parse(written(outcome))).toEqual({ mcpServers: { mine: mine.mcpServers.mine, docs: next } });
    expect(outcome.json?.get('mcpServers docs')).toBe(hashOf(next));
  });

  it('keeps a kit entry the user changed and reports it as diverged', () => {
    const old = { type: 'http', url: 'https://old.example.com/mcp' };
    const changed = { type: 'http', url: 'https://mine.example.com/mcp' };
    const outcome = plan({
      path: '.mcp.json',
      entries: [
        jsonEntry({ mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } } }, [
          'mcpServers docs',
        ]),
      ],
      state: file(JSON.stringify({ mcpServers: { docs: changed } })),
      lock: { 'mcpServers docs': hashOf(old) },
    });
    expect(outcome.ops).toMatchObject([
      { kind: 'skip', reason: expect.stringContaining('diverged') as string },
    ]);
    expect(outcome.content).toBeUndefined();
    expect(outcome.json?.get('mcpServers docs')).toBe(hashOf(old));
  });

  it('records a kit entry the user deleted in removed[] and never adds it back', () => {
    const outcome = plan({
      entries: [
        jsonEntry({ permissions: { deny: ['Bash(rm -rf:*)'] } }, ['permissions.deny Bash(rm -rf:*)']),
      ],
      state: file('{ "permissions": { "deny": [] } }\n'),
      lock: { 'permissions.deny Bash(rm -rf:*)': hashOf('Bash(rm -rf:*)') },
    });
    expect(outcome.ops.find((op) => op.entry === 'permissions.deny Bash(rm -rf:*)')?.kind).toBe(
      'respectRemoval',
    );
    expect(outcome.removed).toEqual([{ path: SETTINGS, key: 'permissions.deny Bash(rm -rf:*)' }]);
    expect(outcome.content ?? '').not.toContain('rm -rf');
  });

  it('gives .mcp.json no $schema', () => {
    const outcome = plan({
      path: '.mcp.json',
      entries: [jsonEntry({ mcpServers: { a: { type: 'stdio', command: 'a' } } }, ['mcpServers a'])],
    });
    expect(Object.keys(JSON.parse(written(outcome)) as object)).toEqual(['mcpServers']);
  });

  it('refuses malformed JSON before any write, naming the file, line and column', () => {
    const run = (): unknown => plan({ state: file('{\n  "model": "opus"\n  "x": 1\n}\n') });
    expect(run).toThrow(MergeError);
    expect(run).toThrow('.claude/settings.json: line 3, column 3: is not valid JSON (comma expected)');
  });

  it('refuses a file whose root is not an object', () => {
    expect(() => plan({ state: file('[]\n') })).toThrow('must hold a JSON object');
  });

  it('refuses to add a rule where the user keeps a value that is not a list', () => {
    expect(() => plan({ state: file('{ "permissions": { "deny": "none" } }\n') })).toThrow(
      'line 1, column 28: permissions.deny is not a list, so the kit cannot add',
    );
  });

  it('removes an unchanged entry the kit no longer writes when the current kit could own it', () => {
    const outcome = plan({
      entries: [],
      state: file('{ "permissions": { "deny": ["Bash(rm -rf:*)", "Read(x)"] } }\n'),
      lock: { 'permissions.deny Bash(rm -rf:*)': hashOf('Bash(rm -rf:*)') },
      ownable: () => true,
    });
    expect(JSON.parse(written(outcome))).toEqual({ permissions: { deny: ['Read(x)'] } });
    expect(outcome.json?.size).toBe(0);
  });

  it('never writes through a symlink, and offers the kit entries in a sidecar', () => {
    const outcome = plan({ state: { kind: 'symlink' } });
    expect(outcome.content).toBeUndefined();
    expect(JSON.parse(outcome.sidecar ?? '')).toMatchObject({ $schema: SETTINGS_SCHEMA });
  });

  it('keeps a different sidecar beside a symlink and says how to get the current entries', () => {
    const outcome = plan({ state: { kind: 'symlink' }, sidecar: file('{ "model": "opus" }\n') });
    expect(outcome.sidecar).toBeUndefined();
    expect(outcome.ops).toMatchObject([
      {
        kind: 'skip',
        reason: expect.stringContaining('cannot tell whether the user edited it') as string,
      },
    ]);
    expect(outcome.ops[0]?.reason).toContain('delete it to get the current entries');
  });
});
