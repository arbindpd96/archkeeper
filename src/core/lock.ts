import type * as z from 'zod/mini';
import { BRAND, type Brand } from './brand.js';
import { type Finding, LockError } from './errors.js';
import { checkSchema } from './issues.js';
import { parseJson } from './json.js';
import { LOCKFILE_VERSION, lockSchema } from './lock-schema.js';
import { compareText } from './text.js';
import { compareVersions, SEMVER } from './version.js';

/** The kit that wrote a lock: its package name and version. */
export interface KitId {
  readonly name: string;
  readonly version: string;
}

/** The lock entry of an owned or create-only file; `base` is null where the kit never wrote the file. */
export interface FileEntry {
  readonly module: string;
  readonly strategy: 'owned' | 'create-only';
  readonly base: string | null;
  readonly pending?: string;
}

/** The lock entry of one managed block. */
export interface BlockEntry {
  readonly base: string | null;
  readonly pending?: string;
}

/** A kit file, block or JSON entry the user deleted, which the kit never recreates. */
export interface Removal {
  readonly path: string;
  readonly blockId?: string;
  readonly key?: string;
}

/** `<state dir>/lock.json` in memory (ADR-0014): every record is a map by project path. */
export interface Lock {
  readonly lockfileVersion: typeof LOCKFILE_VERSION;
  readonly kit: KitId;
  readonly modules: readonly string[];
  readonly files: ReadonlyMap<string, FileEntry>;
  readonly blocks: ReadonlyMap<string, ReadonlyMap<string, BlockEntry>>;
  readonly json: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly removed: readonly Removal[];
}

/** A lock read from disk: one lock, or the readable sides of a lock that a git merge left with conflict markers. */
export type LockRead =
  | { readonly conflicted: false; readonly lock: Lock }
  | { readonly conflicted: true; readonly sides: readonly Lock[] };

type LockJson = z.output<typeof lockSchema>;

const LOCK_SCHEMA = 'schema/lock.schema.json';

/** The project-relative path of the lock. */
export function lockFilePath(brand: Brand = BRAND): string {
  return `${brand.stateDir}/lock.json`;
}

/** A lock with no entries, for a project the kit has never written to. */
export function emptyLock(kit: KitId, modules: readonly string[] = []): Lock {
  const empty = new Map<never, never>();
  return {
    lockfileVersion: LOCKFILE_VERSION,
    kit,
    modules,
    files: empty,
    blocks: empty,
    json: empty,
    removed: [],
  };
}

function mapOf<Value, Result>(
  record: Readonly<Record<string, Value>>,
  convert: (value: Value) => Result,
): Map<string, Result> {
  return new Map(Object.entries(record).map(([key, value]) => [key, convert(value)]));
}

function withPending(base: string | null, pending: string | undefined): BlockEntry {
  return pending === undefined ? { base } : { base, pending };
}

// Built from the JSON.parse output once the schema accepts it: JSON.parse keeps a `__proto__` key as data.
function toLock(json: LockJson): Lock {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    kit: json.kit,
    modules: json.modules,
    files: mapOf(json.files, ({ module, strategy, base, pending }) => ({
      module,
      strategy,
      ...withPending(base, pending),
    })),
    blocks: mapOf(json.blocks, (blocks) => mapOf(blocks, ({ base, pending }) => withPending(base, pending))),
    json: mapOf(json.json, (keys) => mapOf(keys, (hash) => hash)),
    removed: json.removed,
  };
}

const RESTORE = 'restore lock.json from git; only the kit writes it, so a hand edit or a bad merge breaks it';

function invalid(file: string, finding: Finding): LockError {
  const hint = finding.hint === '' ? RESTORE : `${RESTORE} (the schema says: ${finding.hint})`;
  return new LockError({ file, location: finding.location, problem: finding.problem, hint });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawLock(text: string, file: string): Record<string, unknown> {
  const parsed = parseJson(text);
  if (!parsed.ok) throw invalid(file, { ...parsed.finding, hint: '' });
  if (!isRecord(parsed.value)) {
    throw invalid(file, { location: '', problem: 'must be a JSON object', hint: '' });
  }
  return parsed.value;
}

function upgrade(file: string, location: string, problem: string, brand: Brand): LockError {
  const hint = `upgrade ${brand.displayName} (npx ${brand.npmName}@latest) and run it again`;
  return new LockError({ file, location, problem, hint });
}

// A newer lock format, or a lock from a newer kit, must never be rewritten by this one (ADR-0014).
function refuseNewer(raw: Record<string, unknown>, kit: KitId, file: string, brand: Brand): void {
  const { lockfileVersion: version, kit: writer } = raw;
  if (typeof version === 'number' && Number.isInteger(version) && version > LOCKFILE_VERSION) {
    const problem = `${String(version)} is newer than this ${brand.displayName} understands (${String(LOCKFILE_VERSION)})`;
    throw upgrade(file, 'lockfileVersion', problem, brand);
  }
  const written = (writer as { version?: unknown } | undefined)?.version;
  if (typeof written !== 'string' || !SEMVER.test(written)) return;
  if (compareVersions(written, kit.version) <= 0) return;
  const problem = `was written by ${brand.displayName} ${written}, newer than this one (${kit.version})`;
  throw upgrade(file, 'kit.version', problem, brand);
}

function validated(raw: Record<string, unknown>, file: string): Lock {
  const checked = checkSchema(lockSchema, raw, LOCK_SCHEMA);
  if (!checked.ok) throw invalid(file, checked.finding);
  return toLock(raw as LockJson);
}

const OURS = /^<{7}(?: |$)/;
const BASE = /^\|{7}(?: |$)/;
const THEIRS = /^={7}$/;
const END = /^>{7}(?: |$)/;

type Side = 'both' | 'ours' | 'base' | 'theirs';

function nextSide(line: string, side: Side): Side | undefined {
  if (OURS.test(line)) return 'ours';
  if (side === 'ours' && BASE.test(line)) return 'base';
  if (side !== 'both' && THEIRS.test(line)) return 'theirs';
  return END.test(line) ? 'both' : undefined;
}

// Splits a file with git conflict markers into the text of each side; undefined when it has none.
function conflictSides(text: string): [string, string] | undefined {
  const lines = text.split(/(?<=\n)/);
  if (!lines.some((line) => OURS.test(line))) return undefined;
  let side: Side = 'both';
  let ours = '';
  let theirs = '';
  for (const line of lines) {
    const next = nextSide(line.replace(/\r?\n$/, ''), side);
    if (next !== undefined) {
      side = next;
      continue;
    }
    if (side === 'both' || side === 'ours') ours += line;
    if (side === 'both' || side === 'theirs') theirs += line;
  }
  return [ours, theirs];
}

// A side that is not a valid lock on its own is unclear, so the rebuild treats what it held as user edits.
function readableSide(text: string, kit: KitId, file: string, brand: Brand): Lock[] {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) return [];
  refuseNewer(parsed.value, kit, file, brand);
  return checkSchema(lockSchema, parsed.value, LOCK_SCHEMA).ok ? [toLock(parsed.value as LockJson)] : [];
}

/**
 * Reads the lock (ADR-0014). The lock is committed, so it is untrusted: it must match `schema/lock.schema.json`,
 * whose paths pass the same safety checks as every write. A newer `lockfileVersion`, or a lock written by a
 * newer kit than `kit`, throws LockError asking to upgrade. A lock with git conflict markers comes back as its
 * readable sides, for `rebuildLock`.
 */
export function readLock(text: string, kit: KitId, brand: Brand = BRAND): LockRead {
  const file = lockFilePath(brand);
  const sides = conflictSides(text);
  if (sides === undefined) {
    const raw = rawLock(text, file);
    refuseNewer(raw, kit, file, brand);
    return { conflicted: false, lock: validated(raw, file) };
  }
  return { conflicted: true, sides: sides.flatMap((side) => readableSide(side, kit, file, brand)) };
}

function sortedRecord<Value, Result>(
  map: ReadonlyMap<string, Value>,
  convert: (value: Value) => Result,
): Record<string, Result> {
  const keys = [...map.keys()].sort(compareText);
  return Object.fromEntries(keys.map((key) => [key, convert(map.get(key) as Value)]));
}

function removalOrder(left: Removal, right: Removal): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.blockId ?? '', right.blockId ?? '') ||
    compareText(left.key ?? '', right.key ?? '')
  );
}

/** Serialises a lock with sorted keys and a trailing newline, so the same lock is always the same bytes. */
export function serializeLock(lock: Lock): string {
  const json = {
    lockfileVersion: lock.lockfileVersion,
    kit: { name: lock.kit.name, version: lock.kit.version },
    modules: lock.modules,
    files: sortedRecord(lock.files, ({ module, strategy, base, pending }) => ({
      module,
      strategy,
      base,
      pending,
    })),
    blocks: sortedRecord(lock.blocks, (blocks) =>
      sortedRecord(blocks, ({ base, pending }) => ({ base, pending })),
    ),
    json: sortedRecord(lock.json, (keys) => sortedRecord(keys, (hash) => hash)),
    removed: [...lock.removed].sort(removalOrder).map(({ path, blockId, key }) => ({ path, blockId, key })),
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}
