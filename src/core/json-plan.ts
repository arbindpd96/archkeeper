import { parseTree } from 'jsonc-parser';
import type { Brand } from './brand.js';
import { BYTE_ORDER_MARK } from './blocks-file.js';
import { MergeError } from './errors.js';
import { contentHash } from './hash.js';
import {
  containerProblem,
  editDocument,
  entryHash,
  entryValue,
  findEntry,
  parseDocument,
} from './json-entries.js';
import { entryKey, SCHEMA_KEY } from './json-keys.js';
import { lineAndColumn } from './json.js';
import type { Removal } from './lock.js';
import { SETTINGS_FILE } from './manifest-schema.js';
import type { OpKind, Ownable, PathOutcome, PathState, PlanOp } from './plan-types.js';
import type { RenderedEntry } from './render-tree.js';
import { keptSidecarReason, sidecarAction, sidecarPath } from './sidecar.js';

/** The `$schema` the json strategy sets in a settings file that has none (reference §1.8). */
export const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';

const SCHEMAS: Readonly<Record<string, string>> = { [SETTINGS_FILE]: SETTINGS_SCHEMA };
const NEW_DOCUMENT = '{}\n';

/** Everything the planner knows about one co-owned JSON path. */
export interface JsonJob {
  readonly path: string;
  readonly entries: readonly RenderedEntry[];
  readonly state: PathState | undefined;
  readonly sidecar: PathState | undefined;
  /** The lock's ownedKeys for the path: each owned key with the hash of the entry the kit wrote. */
  readonly lock: ReadonlyMap<string, string> | undefined;
  readonly isRemoved: (key: string) => boolean;
  readonly ownable: Ownable;
  /** Whether the kit wrote or adopted the hook script at a path; only such a script is registered (ADR-0014). */
  readonly kitScript: (path: string) => boolean;
  readonly brand: Brand;
}

interface KitEntry {
  readonly key: string;
  readonly value: unknown;
  readonly hash: string;
}

interface Merge {
  readonly job: JsonJob;
  readonly owned: Map<string, string>;
  readonly ops: PlanOp[];
  readonly removed: Removal[];
  text: string;
  edited: boolean;
}

function moduleEntries(path: string, entry: RenderedEntry): (KitEntry & { offset: number })[] {
  const root = parseTree(entry.content);
  return (entry.keys ?? []).map((key) => {
    const found = root === undefined ? undefined : findEntry(root, entryKey(key));
    if (found === undefined) {
      throw new MergeError({
        file: path,
        location: key,
        problem: `is a key of ${entry.module} with no entry in its rendered JSON`,
        hint: 'this is a kit bug; report it with the module id',
      });
    }
    const { node } = found;
    return { key, value: entryValue(entry.content, node), hash: entryHash(node), offset: node.offset };
  });
}

// Entries go in the order each module renders them, after `$schema`, so a new file reads like the render.
function kitEntries(job: JsonJob): KitEntry[] {
  const entries = job.entries.flatMap((entry) =>
    moduleEntries(job.path, entry).sort((left, right) => left.offset - right.offset),
  );
  const schema = SCHEMAS[job.path];
  if (schema === undefined || entries.length === 0) return entries;
  return [{ key: SCHEMA_KEY, value: schema, hash: contentHash(JSON.stringify(schema)) }, ...entries];
}

function record(merge: Merge, kind: OpKind, key: string, reason: string): void {
  merge.ops.push({ kind, path: merge.job.path, entry: key, reason });
}

// Checked on the user's text before any edit, so the line and column point into the file as the user sees it.
function refuseBadContainers(job: JsonJob, text: string, kit: readonly KitEntry[]): void {
  const root = parseDocument(job.path, text);
  for (const { key } of kit) {
    const blocked = containerProblem(root, entryKey(key));
    if (blocked === undefined) continue;
    throw new MergeError({
      file: job.path,
      location: lineAndColumn(text, blocked.location),
      problem: `${blocked.problem}, so the kit cannot add ${key}`,
      hint: 'fix the value there and run again; the kit wrote nothing',
    });
  }
}

function edit(merge: Merge, key: string, value: unknown): void {
  const target = entryKey(key);
  const found = findEntry(parseDocument(merge.job.path, merge.text), target);
  const at = found?.path ?? [...target.container, target.match === 'property' ? target.id : -1];
  merge.text = editDocument(merge.text, at, value, found === undefined && key === SCHEMA_KEY);
  merge.edited = true;
}

/** What happens to one kit entry: the operation, and whether to write it, own it, disown it or record its removal. */
interface Step {
  readonly kind: OpKind;
  readonly reason: string;
  readonly write?: boolean;
  readonly own?: boolean;
  readonly removal?: boolean;
}

function decideEntry(kitHash: string, base: string | undefined, current: string | undefined): Step {
  if (current === undefined && base === undefined) {
    return { kind: 'mergeJson', reason: 'adds the kit entry', write: true, own: true };
  }
  if (current === undefined) {
    const reason = 'the user deleted the kit entry; recorded in removed[] so it is never added back';
    return { kind: 'respectRemoval', reason, removal: true };
  }
  if (base === undefined) {
    return { kind: 'skip', reason: 'the user already has this entry, so it stays theirs' };
  }
  if (current === base && kitHash === base) return { kind: 'skip', reason: 'unchanged' };
  if (current === base) {
    const reason = 'unchanged since the kit wrote it, so it gets the new kit version';
    return { kind: 'mergeJson', reason, write: true, own: true };
  }
  if (current === kitHash) return { kind: 'adopt', reason: 'already holds the kit version', own: true };
  return { kind: 'skip', reason: 'diverged: the user changed it, so it is kept as it is' };
}

function mergeEntry(merge: Merge, entry: KitEntry): void {
  const { key } = entry;
  const { job, owned } = merge;
  if (job.isRemoved(key)) {
    record(merge, 'respectRemoval', key, 'the user deleted it earlier; the kit never adds it back');
    return;
  }
  const target = entryKey(key);
  if (target.match === 'hook' && !job.kitScript(target.id)) {
    record(
      merge,
      'skip',
      key,
      'its script is not one the kit wrote or adopted, so the kit does not register it',
    );
    return;
  }
  const found = findEntry(parseDocument(job.path, merge.text), target);
  const step = decideEntry(
    entry.hash,
    job.lock?.get(key),
    found === undefined ? undefined : entryHash(found.node),
  );
  if (step.write === true) edit(merge, key, entry.value);
  if (step.own === true) owned.set(key, entry.hash);
  if (step.removal === true) {
    owned.delete(key);
    merge.removed.push({ path: job.path, key });
  }
  record(merge, step.kind, key, step.reason);
}

function dropEntry(merge: Merge, key: string, base: string): void {
  const { job, owned } = merge;
  if (!job.ownable(job.path, key)) {
    record(merge, 'skip', key, 'the lock lists it, but no selected module writes it; left alone');
    return;
  }
  const found = findEntry(parseDocument(job.path, merge.text), entryKey(key));
  if (found !== undefined && entryHash(found.node) !== base) {
    record(merge, 'skip', key, 'the kit no longer writes it, but the user changed it; kept');
    return;
  }
  if (found !== undefined) edit(merge, key, undefined);
  owned.delete(key);
  const reason = found === undefined ? 'already gone' : 'unchanged since the kit wrote it, so it is removed';
  record(merge, 'delete', key, `the kit no longer writes it; ${reason}`);
}

function dropUnrendered(merge: Merge, kit: readonly KitEntry[]): void {
  const rendered = new Set(kit.map((entry) => entry.key));
  for (const [key, base] of merge.job.lock ?? []) {
    if (!rendered.has(key)) dropEntry(merge, key, base);
  }
}

function unwritable(job: JsonJob, kit: readonly KitEntry[], what: string): PathOutcome {
  const merge: Merge = { job, owned: new Map(), ops: [], removed: [], text: NEW_DOCUMENT, edited: false };
  for (const entry of kit.filter((candidate) => !job.isRemoved(candidate.key))) {
    edit(merge, entry.key, entry.value);
  }
  const kept = { removed: [], ...(job.lock === undefined ? {} : { json: job.lock }) };
  if (!merge.edited) return { ops: [], ...kept };
  const why = `is ${what}, which the kit never writes through`;
  const action = sidecarAction(job.sidecar, merge.text, () => false);
  const sidecar = sidecarPath(job.path, job.brand);
  if (action === 'write') {
    return {
      ops: [{ kind: 'sidecar', path: job.path, reason: `${why}; its entries go to ${sidecar}` }],
      sidecar: merge.text,
      ...kept,
    };
  }
  const reason =
    action === 'same' ? `${sidecar} already holds the kit entries` : keptSidecarReason(job.path, job.brand);
  return { ops: [{ kind: 'skip', path: job.path, reason: `${why}; ${reason}` }], ...kept };
}

/**
 * Plans a co-owned JSON file (#22, ADR-0014) through jsonc-parser `modify`, keeping comments and formatting.
 * Entries are owned by key: a key the kit never wrote but the user has stays the user's; a kit entry the user
 * changed is kept and reported as diverged; one the user deleted goes to `removed[]`. User entries are never
 * changed or reordered, `$schema` is set only where absent, and malformed JSON throws MergeError before any write.
 */
export function planJson(job: JsonJob): PathOutcome {
  const kit = kitEntries(job);
  const { state } = job;
  if (state !== undefined && state.kind !== 'file') {
    return unwritable(job, kit, state.kind === 'symlink' ? 'a symlink' : 'not a regular text file');
  }
  const content = state === undefined ? NEW_DOCUMENT : state.content;
  const bom = content.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const text = content.slice(bom.length);
  refuseBadContainers(job, text, kit);
  const merge: Merge = { job, owned: new Map(job.lock), ops: [], removed: [], text, edited: false };
  for (const entry of kit) mergeEntry(merge, entry);
  dropUnrendered(merge, kit);
  const written = merge.edited ? { content: bom + merge.text } : {};
  return { ops: merge.ops, removed: merge.removed, json: merge.owned, ...written };
}
