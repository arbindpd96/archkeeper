import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBlob } from '../src/cli/blob-store.js';
import { fixtureCopy } from './helpers.js';
import { filesUnder, projectText } from './install-helpers.js';
import { existingClaudeSetup, KIT, runInit } from './init-helpers.js';
import { TEST_BRAND } from './kit-fixtures.js';
import { generatedProblems } from './static-rules.js';

const PRESETS = KIT.presets.map((preset) => preset.name);
const FIXTURES = ['ts-app', 'py-app', 'mixed', 'existing-claude-setup'] as const;
const STATE = TEST_BRAND.stateDir;
const CONTENT_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/settings.json'];

interface LockShape {
  readonly files?: Readonly<Record<string, { readonly strategy: string }>>;
  readonly blocks?: Readonly<Record<string, unknown>>;
  readonly json?: Readonly<Record<string, unknown>>;
}

function projectOf(fixture: (typeof FIXTURES)[number]): string {
  return fixture === 'existing-claude-setup' ? existingClaudeSetup() : fixtureCopy(fixture).dir;
}

function strategyOf(lock: LockShape, file: string): string {
  if (file.startsWith(`${STATE}/`)) return 'state';
  if (lock.blocks?.[file] !== undefined) return 'blocks';
  if (lock.json?.[file] !== undefined) return 'json';
  return lock.files?.[file]?.strategy ?? 'user';
}

// A blob's gzip bytes can differ between zlib versions; the content it holds, which names it, cannot.
function hashOf(dir: string, file: string): string {
  const bytes = readFileSync(path.join(dir, file));
  if (!file.startsWith(`${STATE}/base/`)) return createHash('sha256').update(bytes).digest('hex');
  readBlob(path.basename(file), bytes, TEST_BRAND);
  return path.basename(file);
}

function contentOf(dir: string, file: string): string {
  const absolute = path.join(dir, file);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8').replaceAll('\r', '<CR>') : '(absent)\n';
}

/** The golden tree of a project: each file's sha256, strategy and path, then the instruction and settings files. */
function goldenText(dir: string): string {
  const lock = JSON.parse(readFileSync(path.join(dir, STATE, 'lock.json'), 'utf8')) as LockShape;
  const files = filesUnder(dir).filter((file) => !file.startsWith(`${STATE}/local/backup/`));
  const tree = files.map((file) => `${hashOf(dir, file)}  ${strategyOf(lock, file).padEnd(11)}  ${file}\n`);
  const contents = CONTENT_FILES.map((file) => `=== ${file}\n${contentOf(dir, file)}`);
  return [...tree, '\n', ...contents].join('');
}

interface Summary {
  readonly plan: readonly { readonly ops: readonly { readonly kind: string }[] }[];
}

describe.each(FIXTURES)('init on %s (#29)', (fixture) => {
  it.each(PRESETS)(
    'with the %s preset writes its golden tree and passes the static rules',
    async (preset) => {
      const dir = projectOf(fixture);
      expect((await runInit(dir, ['--yes', '--preset', preset])).code).toBe(0);
      await expect(goldenText(dir)).toMatchFileSnapshot(`__snapshots__/golden/${fixture}.${preset}.txt`);
      expect(generatedProblems(dir, TEST_BRAND, fixture !== 'existing-claude-setup')).toEqual([]);
    },
  );

  it.each(PRESETS)(
    'with the %s preset plans only skips on a second init and writes nothing',
    async (preset) => {
      const dir = projectOf(fixture);
      await runInit(dir, ['--yes', '--preset', preset]);
      const before = projectText(dir);
      const again = await runInit(dir, ['--json']);
      expect(again.code).toBe(0);
      const { plan } = JSON.parse(again.stdout) as Summary;
      expect(plan.flatMap((entry) => entry.ops).filter((op) => op.kind !== 'skip')).toEqual([]);
      expect(projectText(dir)).toBe(before);
    },
  );
});
