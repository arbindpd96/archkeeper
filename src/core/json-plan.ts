import { parseTree } from 'jsonc-parser';
import type { Brand } from './brand.js';
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
import type { OpKind, Ownable, PathOutcome, PathState, PlanOp, ScriptState } from './plan-types.js';
import type { RenderedEntry } from './render-tree.js';
import { sidecarAction, sidecarPath } from './sidecar.js';
import { BYTE_ORDER_MARK } from './text.js';

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
  /** What the hook script at a path holds once the plan is applied; only the kit's script is registered. */
  readonly script: (path: string) => ScriptState;
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

function unregister(merge: Merge, key: string, base: string): void {
  const found = findEntry(parseDocument(merge.job.path, merge.text), entryKey(key));
  if (found === undefined) {
    merge.owned.delete(key);
    merge.removed.push({ path: merge.job.path, key });
    const reason = 'the user deleted the kit entry; recorded in removed[] so it is never added back';
    record(merge, 'respectRemoval', key, reason);
    return;
  }
  if (entryHash(found.node) !== base) {
    record(merge, 'skip', key, 'its script is gone, but the user changed the registration; kept');
    return;
  }
  edit(merge, key, undefined);
  merge.owned.delete(key);
  record(merge, 'delete', key, 'its script is gone, so the kit removes the registration it wrote');
}

// A hook runs its script, so the kit registers one only where the script holds exactly the kit's content, and
// takes back a registration it wrote once the user deletes the script, so no tool call runs a missing file.
function unregisteredHook(merge: Merge, key: string): boolean {
  const target = entryKey(key);
  if (target.match !== 'hook') return false;
  const script = merge.job.script(target.id);
  if (script === 'kit') return false;
  const base = merge.job.lock?.get(key);
  if (base === undefined) {
    const why = script === 'missing' ? 'is missing' : 'is not the kit version';
    record(merge, 'skip', key, `its script ${why}, so the kit does not register it`);
  } else if (script === 'missing') {
    unregister(merge, key, base);
  } else {
    const reason = 'its script is not the kit version, so the registration the kit wrote is left as it is';
    record(merge, 'skip', key, reason);
  }
  return true;
}

function mergeEntry(merge: Merge, entry: KitEntry): void {
  const { key } = entry;
  const { job, owned } = merge;
  if (job.isRemoved(key)) {
    // Only an owned key left beside the removal, as a rebuilt lock can hold, still changes the lock.
    const disowned = owned.delete(key);
    const reason = 'the user deleted it earlier; the kit never adds it back';
    record(merge, disowned ? 'respectRemoval' : 'skip', key, reason);
    return;
  }
  if (unregisteredHook(merge, key)) return;
  const found = findEntry(parseDocument(job.path, merge.text), entryKey(key));
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

// `$schema` serves the kit's entries, so the kit adds it only where it owns another entry; its op still leads.
function mergeSchema(merge: Merge, schema: KitEntry): void {
  const others = merge.ops.splice(0);
  const owns = [...merge.owned.keys()].some((key) => key !== SCHEMA_KEY);
  if (owns || merge.job.lock?.has(SCHEMA_KEY) === true) mergeEntry(merge, schema);
  else record(merge, 'skip', SCHEMA_KEY, 'the kit owns no other entry in this file, so it adds no $schema');
  merge.ops.push(...others);
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
  // The lock records no pending version of a JSON entry, so the kit cannot tell its own earlier sidecar from one
  // the user edited; it keeps any sidecar that differs and says how to get the current entries.
  const reason =
    action === 'same'
      ? `${sidecar} already holds the kit entries`
      : `${sidecar} differs from the current kit entries, and the kit cannot tell whether the user edited it, so it is left alone; delete it to get the current entries`;
  return { ops: [{ kind: 'skip', path: job.path, reason: `${why}; ${reason}` }], ...kept };
}

/**
 * Plans a co-owned JSON file (#22, ADR-0014) through jsonc-parser `modify`, keeping comments and formatting.
 * Entries are owned by key: a key the kit never wrote but the user has stays the user's; a kit entry the user
 * changed is kept and reported as diverged; one the user deleted goes to `removed[]`. User entries are never
 * changed or reordered, `$schema` is set only where absent and the kit owns another entry, and malformed JSON
 * throws MergeError before any write.
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
  const schema = kit.find((entry) => entry.key === SCHEMA_KEY);
  for (const entry of kit.filter((candidate) => candidate !== schema)) mergeEntry(merge, entry);
  dropUnrendered(merge, kit);
  if (schema !== undefined) mergeSchema(merge, schema);
  const written = merge.edited ? { content: bom + merge.text } : {};
  return { ops: merge.ops, removed: merge.removed, json: merge.owned, ...written };
}
