import { ShellSyntaxError } from './syntax.js';

// Unquoted brace syntax is swapped for private-use code points so quoted braces stay literal while expanding.
const OPEN = '';
const COMMA = '';
const CLOSE = '';
const MARKERS: ReadonlyMap<string, string> = new Map([
  ['{', OPEN],
  [',', COMMA],
  ['}', CLOSE],
]);
const MAX_WORDS = 256;
const MAX_WORD_LENGTH = 1024;
const NUMERIC_RANGE = /^(-?\d{1,6})\.\.(-?\d{1,6})(?:\.\.(-?\d{1,6}))?$/;
const LETTER_RANGE = /^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d{1,6}))?$/;

interface Group {
  readonly start: number;
  readonly cuts: number[];
}

interface Expansion {
  readonly start: number;
  readonly end: number;
  readonly alternatives: readonly string[];
}

/** Told how many characters each expansion step scans, so the caller can cap the total work. */
export type Charge = (amount: number) => void;

function tooLarge(): never {
  throw new ShellSyntaxError('a brace expansion too large to inspect');
}

function range(
  first: number,
  last: number,
  increment: string | undefined,
  toText: (value: number) => string,
): string[] {
  const step = Math.max(1, Math.abs(Number(increment ?? 1))) * (first <= last ? 1 : -1);
  const count = Math.floor((last - first) / step) + 1;
  if (count > MAX_WORDS) tooLarge();
  return Array.from({ length: count }, (_, index) => toText(first + index * step));
}

function sequence(body: string): string[] | null {
  const numbers = NUMERIC_RANGE.exec(body);
  if (numbers) return range(Number(numbers[1]), Number(numbers[2]), numbers[3], String);
  const letters = LETTER_RANGE.exec(body);
  if (!letters) return null;
  const [, first = '', last = '', increment] = letters;
  return range(first.charCodeAt(0), last.charCodeAt(0), increment, (code) => String.fromCharCode(code));
}

function alternativesOf(word: string, { start, cuts }: Group, end: number): string[] | null {
  if (cuts.length === 0) return sequence(word.slice(start + 1, end));
  const bounds = [start, ...cuts, end];
  return bounds.slice(1).map((bound, index) => word.slice((bounds[index] ?? 0) + 1, bound));
}

/** Finds the leftmost brace group that expands, with one stack pass over the word. */
function firstGroup(word: string): Expansion | null {
  const open: Group[] = [];
  let best: Expansion | null = null;
  for (let index = 0; index < word.length; index += 1) {
    const char = word[index];
    if (char === OPEN) open.push({ start: index, cuts: [] });
    else if (char === COMMA) open.at(-1)?.cuts.push(index);
    else if (char === CLOSE) best = closeGroup(word, open.pop(), index, best);
  }
  return best;
}

function closeGroup(
  word: string,
  group: Group | undefined,
  end: number,
  best: Expansion | null,
): Expansion | null {
  if (group === undefined || (best !== null && best.start < group.start)) return best;
  const alternatives = alternativesOf(word, group, end);
  return alternatives ? { start: group.start, end, alternatives } : best;
}

function expandAll(word: string, words: string[], charge: Charge): void {
  charge(word.length);
  const group = firstGroup(word);
  if (group === null) {
    words.push(word);
  } else {
    for (const alternative of group.alternatives) {
      expandAll(word.slice(0, group.start) + alternative + word.slice(group.end + 1), words, charge);
    }
  }
  if (words.length > MAX_WORDS) tooLarge();
}

/**
 * Expands bash and zsh brace syntax (`{a,b}`, `{1..9..2}`) in one word. `positions` lists the indexes of the
 * `{`, `,` and `}` characters that were unquoted, since only those take part in brace expansion.
 */
export function expandBraces(
  text: string,
  positions: readonly number[],
  charge: Charge = () => undefined,
): string[] {
  if (positions.length === 0) return [text];
  if (text.length > MAX_WORD_LENGTH) tooLarge();
  if ([OPEN, COMMA, CLOSE].some((marker) => text.includes(marker))) {
    throw new ShellSyntaxError('reserved private-use characters');
  }
  // Positions count UTF-16 code units, as the word reader measured them, so split the same way.
  const marked = text.split('');
  for (const position of positions) {
    const char = marked[position] ?? '';
    marked[position] = MARKERS.get(char) ?? char;
  }
  const words: string[] = [];
  expandAll(marked.join(''), words, charge);
  return words.map((word) => word.replaceAll(OPEN, '{').replaceAll(COMMA, ',').replaceAll(CLOSE, '}'));
}
