import { toLf } from './text.js';

type EditKind = ' ' | '-' | '+';

interface Edit {
  readonly kind: EditKind;
  readonly line: string;
}

const CONTEXT = 3;
// Past this many line pairs the diff shows a whole-file change rather than spend memory on the table.
const MAX_CELLS = 4_000_000;
const NO_NEWLINE = '\\ No newline at end of file';

// A last line without a newline keeps one as a marker: no split line can hold one, and it differs from the same
// line with a newline, as diff -u treats it.
function linesOf(text: string | undefined): string[] {
  if (text === undefined || text === '') return [];
  const lines = toLf(text).split('\n');
  const last = lines.pop() ?? '';
  return last === '' ? lines : [...lines, `${last}\n`];
}

function keep(line: string): Edit {
  return { kind: ' ', line };
}

function lcsTable(before: readonly string[], after: readonly string[]): (i: number, j: number) => number {
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const same = before[i] === after[j];
      table[i * width + j] = same ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

function middleEdits(before: readonly string[], after: readonly string[]): Edit[] {
  const removed = before.map((line): Edit => ({ kind: '-', line }));
  const added = after.map((line): Edit => ({ kind: '+', line }));
  if (before.length * after.length > MAX_CELLS) return [...removed, ...added];
  const at = lcsTable(before, after);
  const edits: Edit[] = [];
  let [i, j] = [0, 0];
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      edits.push(keep(before[i] ?? ''));
      [i, j] = [i + 1, j + 1];
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      edits.push(removed[i] ?? keep(''));
      i += 1;
    } else {
      edits.push(added[j] ?? keep(''));
      j += 1;
    }
  }
  return [...edits, ...removed.slice(i), ...added.slice(j)];
}

// The common start and end go around the table, so a block added to a long file costs almost nothing.
function editsOf(before: readonly string[], after: readonly string[]): Edit[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let end = 0;
  const fits = (): boolean => end < before.length - start && end < after.length - start;
  while (fits() && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  const middle = middleEdits(
    before.slice(start, before.length - end),
    after.slice(start, after.length - end),
  );
  return [...before.slice(0, start).map(keep), ...middle, ...before.slice(before.length - end).map(keep)];
}

/** Groups changed edits that lie within twice the context of each other into hunks, as `[first, last]` indices. */
function hunkRanges(edits: readonly Edit[]): [number, number][] {
  const changed = edits.flatMap((edit, index) => (edit.kind === ' ' ? [] : [index]));
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const last = ranges.at(-1);
    if (last !== undefined && index - last[1] <= 2 * CONTEXT) last[1] = index;
    else ranges.push([index, index]);
  }
  return ranges.map(([first, last]) => [
    Math.max(0, first - CONTEXT),
    Math.min(edits.length - 1, last + CONTEXT),
  ]);
}

function printed(edit: Edit): string {
  const line = `${edit.kind}${edit.line}`;
  return line.endsWith('\n') ? `${line}${NO_NEWLINE}` : line;
}

function count(edits: readonly Edit[], kinds: string): number {
  return edits.filter((edit) => kinds.includes(edit.kind)).length;
}

function hunk(edits: readonly Edit[], [first, last]: [number, number]): string {
  const before = edits.slice(0, first);
  const body = edits.slice(first, last + 1);
  const [oldCount, newCount] = [count(body, ' -'), count(body, ' +')];
  const oldStart = count(before, ' -') + (oldCount === 0 ? 0 : 1);
  const newStart = count(before, ' +') + (newCount === 0 ? 0 : 1);
  const header = `@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@`;
  return [header, ...body.map(printed)].join('\n');
}

/**
 * A unified diff of one project file, as `diff -u` prints it with three lines of context, or `''` when nothing
 * changes. `before` is undefined for a file the change creates and `after` for one it deletes. Line endings are
 * compared as LF, since the kit keeps a file's own line endings when it writes it.
 */
export function unifiedDiff(path: string, before: string | undefined, after: string | undefined): string {
  const edits = editsOf(linesOf(before), linesOf(after));
  const ranges = hunkRanges(edits);
  if (ranges.length === 0) return '';
  const from = before === undefined ? '/dev/null' : `a/${path}`;
  const to = after === undefined ? '/dev/null' : `b/${path}`;
  return `${[`--- ${from}`, `+++ ${to}`, ...ranges.map((range) => hunk(edits, range))].join('\n')}\n`;
}
