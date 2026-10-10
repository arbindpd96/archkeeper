import {
  applyEdits,
  findNodeAtLocation,
  type FormattingOptions,
  type JSONPath,
  modify,
  type Node,
  type ParseError,
  parseTree,
} from 'jsonc-parser';
import { MergeError } from './errors.js';
import { contentHash } from './hash.js';
import { lineAndColumn, parseErrorWords } from './json.js';
import type { EntryKey } from './json-keys.js';
import { hookArgument } from './render-json.js';
import { compareText, quoted } from './text.js';

/** A kit-owned entry found in a JSON document: its JSON path for edits and its syntax node. */
export interface FoundEntry {
  readonly path: JSONPath;
  readonly node: Node;
}

const LENIENT = { allowTrailingComma: true, disallowComments: false, allowEmptyContent: false };

function repeatedName(object: Node): Node | undefined {
  const names = new Set<unknown>();
  for (const property of object.children ?? []) {
    const [name] = property.children ?? [];
    if (names.has(name?.value)) return name;
    names.add(name?.value);
  }
  return undefined;
}

function duplicateKey(node: Node): Node | undefined {
  const repeated = node.type === 'object' ? repeatedName(node) : undefined;
  if (repeated !== undefined) return repeated;
  for (const child of node.children ?? []) {
    const found = duplicateKey(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

// JSON.parse, and so Claude Code, keeps the last of two equal keys, but jsonc-parser finds the first: the kit
// would edit an object nobody reads, such as a dead `permissions`, and report its rules as in place.
function refuseDuplicateKeys(path: string, text: string, root: Node): void {
  const repeated = duplicateKey(root);
  if (repeated === undefined) return;
  throw new MergeError({
    file: path,
    location: lineAndColumn(text, repeated.offset),
    problem: `holds the key ${quoted(String(repeated.value))} twice in one object, and JSON readers use only the last one`,
    hint: 'merge the two into one key and run again; the kit wrote nothing',
  });
}

/**
 * Parses a co-owned JSON file, comments and trailing commas allowed, and returns its root object. Malformed JSON,
 * a root that is not an object, or a key repeated in one object throws MergeError naming the file, line and
 * column, before any write.
 */
export function parseDocument(path: string, text: string): Node {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, LENIENT);
  const [first] = errors;
  if (first === undefined && root?.type === 'object') {
    refuseDuplicateKeys(path, text, root);
    return root;
  }
  const problem =
    first === undefined ? 'must hold a JSON object' : `is not valid JSON (${parseErrorWords(first.error)})`;
  throw new MergeError({
    file: path,
    location: lineAndColumn(text, first === undefined ? 0 : first.offset),
    problem,
    hint: 'fix the JSON at that spot and run again; the kit wrote nothing',
  });
}

function hookArgs(group: Node): string[] {
  const handlers = findNodeAtLocation(group, ['hooks']);
  if (handlers?.type !== 'array') return [];
  return (handlers.children ?? []).flatMap((handler) => {
    const args = findNodeAtLocation(handler, ['args']);
    return args?.type === 'array' ? (args.children ?? []).map((arg) => String(arg.value)) : [];
  });
}

function matches(node: Node, key: EntryKey): boolean {
  if (key.match === 'string') return node.type === 'string' && node.value === key.id;
  return node.type === 'object' && hookArgs(node).includes(hookArgument(key.id));
}

function propertyEntry(container: Node | undefined, key: EntryKey): FoundEntry | undefined {
  if (container?.type !== 'object') return undefined;
  const property = container.children?.find((child) => child.children?.[0]?.value === key.id);
  const value = property?.children?.[1];
  return value === undefined ? undefined : { path: [...key.container, key.id], node: value };
}

function itemEntry(container: Node | undefined, key: EntryKey): FoundEntry | undefined {
  if (container?.type !== 'array') return undefined;
  const children = container.children ?? [];
  const index = children.findIndex((child) => matches(child, key));
  const node = children[index];
  return node === undefined ? undefined : { path: [...key.container, index], node };
}

/** Finds the entry an owned key names in a parsed document, or returns undefined when it has none. */
export function findEntry(root: Node, key: EntryKey): FoundEntry | undefined {
  const container = findNodeAtLocation(root, [...key.container]);
  return key.match === 'property' ? propertyEntry(container, key) : itemEntry(container, key);
}

/**
 * Says where an entry for `key` cannot go, or returns undefined: every container on its path must be an object,
 * or absent, and the last one a list (rules and hooks) or an object (servers and `$schema`).
 */
export function containerProblem(
  root: Node,
  key: EntryKey,
): { location: number; problem: string } | undefined {
  for (let depth = 1; depth <= key.container.length; depth += 1) {
    const path = key.container.slice(0, depth);
    const node = findNodeAtLocation(root, path);
    if (node === undefined) return undefined;
    const wanted = depth === key.container.length && key.match !== 'property' ? 'array' : 'object';
    if (node.type !== wanted) {
      return {
        location: node.offset,
        problem: `${path.join('.')} is not ${wanted === 'array' ? 'a list' : 'an object'}`,
      };
    }
  }
  return undefined;
}

// Key order and formatting do not count as a change, so an entry is hashed in a canonical form.
function canonical(node: Node): string {
  if (node.type === 'array') return `[${(node.children ?? []).map(canonical).join(',')}]`;
  if (node.type !== 'object') return JSON.stringify(node.value);
  const properties = (node.children ?? []).map((property) => {
    const [name, value] = property.children ?? [];
    return `${JSON.stringify(name?.value)}:${value === undefined ? 'null' : canonical(value)}`;
  });
  return `{${properties.sort(compareText).join(',')}}`;
}

/** The hash of an entry as the lock's ownedKeys record it: sha256 of its canonical JSON. */
export function entryHash(node: Node): string {
  return contentHash(canonical(node));
}

/** The value of an entry, read with JSON.parse so a `__proto__` key stays plain data. */
export function entryValue(text: string, node: Node): unknown {
  return JSON.parse(text.slice(node.offset, node.offset + node.length));
}

/** The indentation and line ending a document already uses, so edits match the user's formatting. */
export function formattingOf(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ';
  return indent.startsWith('\t')
    ? { insertSpaces: false, tabSize: 1, eol }
    : { insertSpaces: true, tabSize: indent.length, eol };
}

/** Sets (or, with undefined, removes) the value at `path` through jsonc-parser, keeping comments and formatting. */
export function editDocument(text: string, path: JSONPath, value: unknown, first = false): string {
  const options = { formattingOptions: formattingOf(text), ...(first ? { getInsertionIndex: () => 0 } : {}) };
  return applyEdits(text, modify(text, path, value, options));
}
