import { BRAND, type Brand } from './brand.js';
import { blockParts, parseBlocks } from './blocks-file.js';
import { MergeError } from './errors.js';
import { contentHash } from './hash.js';
import type { BlockEntry, FileEntry, Lock } from './lock.js';
import type { Snapshot } from './plan-types.js';
import { compareVersions } from './version.js';

type Entry = FileEntry | BlockEntry;

// The first map that has a key wins, so passing the sides newest first keeps the newer kit's entries.
function union<Value>(maps: readonly ReadonlyMap<string, Value>[]): Map<string, Value> {
  const merged = new Map<string, Value>();
  for (const map of maps) {
    for (const [key, value] of map) if (!merged.has(key)) merged.set(key, value);
  }
  return merged;
}

function nestedUnion<Value>(
  maps: readonly ReadonlyMap<string, ReadonlyMap<string, Value>>[],
): Map<string, ReadonlyMap<string, Value>> {
  const paths = new Set(maps.flatMap((map) => [...map.keys()]));
  return new Map([...paths].map((path) => [path, union(maps.flatMap((map) => map.get(path) ?? []))]));
}

// An entry whose content on disk is known kit content takes it as its base; anything else stays as it was.
function rebased<Value extends Entry>(
  entry: Value,
  current: string | undefined,
  known: (hash: string) => boolean,
): Value {
  if (current === undefined || current === entry.base || !known(current)) return entry;
  const { pending, ...rest } = entry;
  return {
    ...rest,
    base: current,
    ...(pending === undefined || pending === current ? {} : { pending }),
  } as Value;
}

function fileHash(snapshot: Snapshot, path: string): string | undefined {
  const state = snapshot.get(path);
  return state?.kind === 'file' ? contentHash(state.content) : undefined;
}

function blockHashes(snapshot: Snapshot, path: string, brand: Brand): ReadonlyMap<string, string> {
  const state = snapshot.get(path);
  if (state?.kind !== 'file') return new Map();
  try {
    const parts = blockParts(parseBlocks(path, state.content, brand));
    return new Map([...parts].map(([id, part]) => [id, contentHash(part.body)]));
  } catch (error) {
    // Broken markers make every block unclear; planning the file reports them again.
    if (error instanceof MergeError) return new Map();
    throw error;
  }
}

/**
 * Rebuilds a lock that a git merge left with conflict markers (ADR-0014), from its readable sides. Each entry
 * comes from the side written by the newer kit (the first side when the versions are equal), `removed[]` is
 * the union of both, and an entry whose content on disk hashes to an existing blob, or to a hash either side
 * recorded for it, takes that as its base. Anything still unclear counts as a user edit, so the worst outcome is
 * an extra sidecar. Returns undefined when no side is readable, so planning starts as on first contact.
 */
export function rebuildLock(
  sides: readonly Lock[],
  snapshot: Snapshot,
  blobs: ReadonlySet<string>,
  brand: Brand = BRAND,
): Lock | undefined {
  const ordered = [...sides].sort((left, right) => compareVersions(right.kit.version, left.kit.version));
  const [newest] = ordered;
  if (newest === undefined) return undefined;
  const knownFor =
    (entries: readonly (Entry | undefined)[]) =>
    (hash: string): boolean =>
      blobs.has(hash) || entries.some((entry) => entry?.base === hash || entry?.pending === hash);
  const files = new Map(
    [...union(ordered.map((side) => side.files))].map(([path, entry]) => {
      const known = knownFor(ordered.map((side) => side.files.get(path)));
      return [path, rebased(entry, fileHash(snapshot, path), known)];
    }),
  );
  const blocks = new Map(
    [...nestedUnion(ordered.map((side) => side.blocks))].map(([path, entries]) => {
      const current = blockHashes(snapshot, path, brand);
      const rebuilt = [...entries].map(([id, entry]) => {
        const known = knownFor(ordered.map((side) => side.blocks.get(path)?.get(id)));
        return [id, rebased(entry, current.get(id), known)] as const;
      });
      return [path, new Map(rebuilt)] as const;
    }),
  );
  const json = nestedUnion(ordered.map((side) => side.json));
  const removed = ordered.flatMap((side) => side.removed);
  return { ...newest, files, blocks, json, removed };
}
