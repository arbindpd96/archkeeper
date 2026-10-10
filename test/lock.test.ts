import { describe, expect, it } from 'vitest';
import { LockError } from '../src/core/errors.js';
import { contentHash, HASH } from '../src/core/hash.js';
import { JSON_KEY } from '../src/core/json-keys.js';
import { emptyLock, type Lock, lockFilePath, readLock, serializeLock } from '../src/core/lock.js';
import { compareVersions } from '../src/core/version.js';
import { TEST_BRAND } from './kit-fixtures.js';

const KIT = { name: 'acmekit', version: '1.2.0' };
const A = contentHash('a\n');
const B = contentHash('b\n');

function sampleLock(): Lock {
  return {
    ...emptyLock(KIT, ['base', 'safety']),
    files: new Map([
      ['docs/notes.md', { module: 'base', strategy: 'create-only', base: A }],
      ['.claude/rules/acmekit/a.md', { module: 'base', strategy: 'owned', base: null, pending: B }],
    ]),
    blocks: new Map([['CLAUDE.md', new Map([['imports', { base: A }]])]]),
    json: new Map([['.claude/settings.json', new Map([['permissions.deny Read(**/.env)', B]])]]),
    removed: [{ path: 'AGENTS.md', blockId: 'rules' }, { path: 'docs/x.md' }],
  };
}

function lockText(change: (json: Record<string, unknown>) => void): string {
  const json = JSON.parse(serializeLock(sampleLock())) as Record<string, unknown>;
  change(json);
  return JSON.stringify(json);
}

function lockError(text: string, kit = KIT): LockError {
  try {
    readLock(text, kit, TEST_BRAND);
  } catch (error) {
    if (error instanceof LockError) return error;
    throw error;
  }
  throw new Error('the lock was read without an error');
}

describe('contentHash', () => {
  it('hashes LF-normalised text, so an autocrlf checkout reads as unchanged', () => {
    expect(contentHash('a\r\nb\r\n')).toBe(contentHash('a\nb\n'));
    expect(contentHash('a\n')).toMatch(HASH);
    expect(contentHash('a\n')).not.toBe(contentHash('a'));
  });
});

describe('compareVersions', () => {
  it.each([
    ['0.1.0', '0.1.0', 0],
    ['0.1.0-rc.0', '0.1.0', -1],
    ['0.1.0-rc.1', '0.1.0-rc.0', 1],
    ['0.1.0-rc.10', '0.1.0-rc.9', 1],
    ['0.1.0-alpha', '0.1.0-1', 1],
    ['0.1.0-rc', '0.1.0-rc.0', -1],
    ['0.10.0', '0.9.9', 1],
    ['1.0.0+build.1', '1.0.0', 0],
  ])('orders %s against %s as %i', (left, right, order) => {
    expect(Math.sign(compareVersions(left, right))).toBe(order);
  });

  it('throws on a version that is not semantic', () => {
    expect(() => compareVersions('1.0', '1.0.0')).toThrow('not a semantic version');
  });
});

describe('JSON_KEY', () => {
  it.each([
    '$schema',
    'permissions.deny Read(**/.env)',
    'permissions.allow Bash(npm test)',
    'hooks.PreToolUse .claude/hooks/acmekit/guard.mjs',
    'mcpServers docs',
  ])('accepts %s', (key) => {
    expect(JSON_KEY.test(key)).toBe(true);
  });

  it.each([
    'env FOO',
    'permissions.defaultMode x',
    'hooks.SessionEnd x',
    'mcpServers',
    'mcpServers a\nb',
    '$schema x',
    'permissions.deny Read(x) \u001b[1A\u001b[2K',
    'permissions.allow Bash(x)\u009b2K',
    'mcpServers \u0007docs',
    'mcpServers a\u2028b',
    'permissions.deny Bash(\u202Efr- mr)',
  ])('refuses %j', (key) => {
    expect(JSON_KEY.test(key)).toBe(false);
  });
});

describe('serializeLock and readLock', () => {
  it('round-trips a lock through its text', () => {
    const text = serializeLock(sampleLock());
    const read = readLock(text, KIT, TEST_BRAND);
    expect(read.conflicted).toBe(false);
    if (read.conflicted) return;
    expect(read.lock).toEqual(sampleLock());
    expect(serializeLock(read.lock)).toBe(text);
  });

  it('writes sorted keys and a trailing newline, the same bytes in any insertion order', () => {
    const lock = sampleLock();
    const reversed: Lock = {
      ...lock,
      files: new Map([...lock.files].reverse()),
      removed: [...lock.removed].reverse(),
    };
    const text = serializeLock(lock);
    expect(serializeLock(reversed)).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.indexOf('.claude/rules/acmekit/a.md')).toBeLessThan(text.indexOf('docs/notes.md'));
  });

  it('keeps a __proto__ path as data, never as a prototype', () => {
    const text = lockText((json) => {
      json.files = JSON.parse(
        `{"__proto__": {"module": "base", "strategy": "owned", "base": "${A}"}}`,
      ) as unknown;
    });
    const read = readLock(text, KIT, TEST_BRAND);
    if (read.conflicted) throw new Error('not conflicted');
    expect([...read.lock.files.keys()]).toEqual(['__proto__']);
    expect(serializeLock(read.lock)).toContain('"__proto__": {');
  });

  it('names the lock file under the brand state folder', () => {
    expect(lockFilePath(TEST_BRAND)).toBe('.acmekit/lock.json');
  });
});

describe('an untrusted lock', () => {
  it.each([
    [
      'a path outside the project',
      (json: Record<string, unknown>) =>
        (json.files = { '../x.md': { module: 'm', strategy: 'owned', base: A } }),
      'files',
      '".." segment',
    ],
    [
      'a path inside .git',
      (json: Record<string, unknown>) => (json.blocks = { '.git/config': {} }),
      'blocks',
      'inside .git',
    ],
    [
      'an absolute path in removed[]',
      (json: Record<string, unknown>) => (json.removed = [{ path: '/etc/passwd' }]),
      'removed[0]',
      'absolute',
    ],
    [
      'a hash that could name a path',
      (json: Record<string, unknown>) => (json.blocks = { 'CLAUDE.md': { a: { base: '../../x' } } }),
      'blocks',
      'sha256',
    ],
    [
      'a JSON key the kit never owns',
      (json: Record<string, unknown>) => (json.json = { '.mcp.json': { 'env TOKEN': A } }),
      'json',
      'name $schema',
    ],
    [
      'a JSON key with a terminal escape that could hide a plan line',
      (json: Record<string, unknown>) =>
        (json.json = { '.claude/settings.json': { 'permissions.deny x \u001b[1A\u001b[2K': A } }),
      'json',
      'name $schema',
    ],
    [
      'a kit name with a control character',
      (json: Record<string, unknown>) => (json.kit = { name: 'acmekit\u001b]8;;', version: '1.2.0' }),
      'kit.name',
      'no control character',
    ],
    ['an unknown key', (json: Record<string, unknown>) => (json.extra = true), '', 'extra'],
    [
      'a removal naming a block and a key',
      (json: Record<string, unknown>) => (json.removed = [{ path: 'a.md', blockId: 'a', key: '$schema' }]),
      'removed[0]',
      '',
    ],
  ])('refuses %s', (_name, change, location, problem) => {
    const error = lockError(lockText(change));
    expect(error.file).toBe('.acmekit/lock.json');
    expect(error.location.startsWith(location)).toBe(true);
    expect(error.message).toContain(problem);
    expect(error.message).toContain('restore lock.json from git');
  });

  it('refuses text that is not JSON, naming the line', () => {
    expect(lockError('{\n  "lockfileVersion": 1,\n}').location).toBe('line 3, column 1');
  });

  it('asks to upgrade when the lock format is newer', () => {
    const error = lockError(lockText((json) => (json.lockfileVersion = 2)));
    expect(error.location).toBe('lockfileVersion');
    expect(error.message).toContain('2 is newer than this Acme Kit understands (1)');
    expect(error.message).toContain('npx acmekit@latest');
  });

  it('refuses to run under a kit older than the one that wrote the lock', () => {
    const error = lockError(serializeLock(sampleLock()), { name: 'acmekit', version: '1.1.9' });
    expect(error.location).toBe('kit.version');
    expect(error.message).toContain('written by Acme Kit 1.2.0, newer than this one (1.1.9)');
  });

  it('reads a lock written by an older or equal kit', () => {
    expect(
      readLock(serializeLock(sampleLock()), { name: 'acmekit', version: '1.2.0' }, TEST_BRAND).conflicted,
    ).toBe(false);
    expect(
      readLock(serializeLock(sampleLock()), { name: 'acmekit', version: '2.0.0-rc.0' }, TEST_BRAND)
        .conflicted,
    ).toBe(false);
  });
});

describe('a lock with git conflict markers', () => {
  function conflicted(ours: string, theirs: string): string {
    return `<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> feature\n`;
  }

  it('comes back as the readable sides', () => {
    const ours = serializeLock(sampleLock());
    const theirs = serializeLock({ ...sampleLock(), kit: { name: 'acmekit', version: '1.1.0' } });
    const read = readLock(conflicted(ours, theirs), KIT, TEST_BRAND);
    expect(read.conflicted).toBe(true);
    if (!read.conflicted) return;
    expect(read.sides.map((side) => side.kit.version)).toEqual(['1.2.0', '1.1.0']);
  });

  it('splits a conflict in the middle of the file, with a diff3 base section', () => {
    const lines = serializeLock(sampleLock()).split('\n');
    const at = lines.findIndex((line) => line.includes('"version"'));
    const text = [
      ...lines.slice(0, at),
      '<<<<<<< ours',
      '    "version": "1.0.0"',
      '||||||| base',
      '    "version": "0.9.0"',
      '=======',
      '    "version": "1.1.0"',
      '>>>>>>> theirs',
      ...lines.slice(at + 1),
    ].join('\n');
    const read = readLock(text, KIT, TEST_BRAND);
    if (!read.conflicted) throw new Error('expected a conflict');
    expect(read.sides.map((side) => side.kit.version)).toEqual(['1.0.0', '1.1.0']);
  });

  it('drops a side that is not a valid lock on its own', () => {
    const read = readLock(conflicted('{ "broken": \n', serializeLock(sampleLock())), KIT, TEST_BRAND);
    if (!read.conflicted) throw new Error('expected a conflict');
    expect(read.sides).toHaveLength(1);
  });

  it('still refuses a side written by a newer kit', () => {
    const newer = serializeLock({ ...sampleLock(), kit: { name: 'acmekit', version: '9.0.0' } });
    expect(() => readLock(conflicted(serializeLock(sampleLock()), newer), KIT, TEST_BRAND)).toThrow(
      'written by Acme Kit 9.0.0',
    );
  });
});
