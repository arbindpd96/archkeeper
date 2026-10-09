import { ShellSyntaxError } from './shell-words.mjs';

// Unquoted brace syntax is swapped for private-use code points so quoted braces stay literal while expanding.
const [OPEN, COMMA, CLOSE] = [0xe000, 0xe001, 0xe002].map((code) => String.fromCharCode(code));
const MARKERS = new Map([
  ['{', OPEN],
  [',', COMMA],
  ['}', CLOSE],
]);
const MAX_WORDS = 256;
const MAX_WORD_LENGTH = 1024;
const NUMERIC_RANGE = /^(-?\d{1,6})\.\.(-?\d{1,6})(?:\.\.(-?\d{1,6}))?$/;
const LETTER_RANGE = /^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d{1,6}))?$/;

function tooLarge() {
  throw new ShellSyntaxError('a brace expansion too large to inspect');
}

function range(first, last, increment, toText) {
  const step = Math.max(1, Math.abs(Number(increment ?? 1))) * (first <= last ? 1 : -1);
  const count = Math.floor((last - first) / step) + 1;
  if (count > MAX_WORDS) tooLarge();
  return Array.from({ length: count }, (_, i) => toText(first + i * step));
}

function sequence(body) {
  const numbers = NUMERIC_RANGE.exec(body);
  if (numbers) return range(Number(numbers[1]), Number(numbers[2]), numbers[3], String);
  const letters = LETTER_RANGE.exec(body);
  if (!letters) return null;
  const [, first, last, increment] = letters;
  return range(first.charCodeAt(0), last.charCodeAt(0), increment, (code) => String.fromCharCode(code));
}

function alternativesOf(word, { start, cuts }, end) {
  if (cuts.length === 0) return sequence(word.slice(start + 1, end));
  const bounds = [start, ...cuts, end];
  return bounds.slice(1).map((bound, i) => word.slice(bounds[i] + 1, bound));
}

/** Finds the leftmost brace group that expands, with one stack pass over the word. */
function firstGroup(word) {
  const open = [];
  let best = null;
  for (let index = 0; index < word.length; index += 1) {
    if (word[index] === OPEN) open.push({ start: index, cuts: [] });
    else if (word[index] === COMMA) open.at(-1)?.cuts.push(index);
    else if (word[index] === CLOSE && open.length > 0) {
      const group = open.pop();
      const alternatives = best && best.start < group.start ? null : alternativesOf(word, group, index);
      if (alternatives) best = { start: group.start, end: index, alternatives };
    }
  }
  return best;
}

function expandAll(word, words, charge) {
  charge(word.length);
  const group = firstGroup(word);
  if (!group) words.push(word);
  for (const alternative of group?.alternatives ?? []) {
    expandAll(word.slice(0, group.start) + alternative + word.slice(group.end + 1), words, charge);
  }
  if (words.length > MAX_WORDS) tooLarge();
}

/**
 * Expands bash/zsh brace syntax (`{a,b}`, `{1..9..2}`) in one word. `positions` lists the indexes of the `{`, `,`
 * and `}` characters that were unquoted, since only those take part in brace expansion. `charge` is told how
 * many characters each step scans, so the caller can cap the total work.
 */
export function expandBraces(text, positions, charge = () => undefined) {
  if (positions.length === 0) return [text];
  if (text.length > MAX_WORD_LENGTH) tooLarge();
  if ([OPEN, COMMA, CLOSE].some((marker) => text.includes(marker))) {
    throw new ShellSyntaxError('reserved private-use characters');
  }
  const marked = text.split('');
  for (const position of positions) marked[position] = MARKERS.get(marked[position]) ?? marked[position];
  const words = [];
  expandAll(marked.join(''), words, charge);
  return words.map((word) => word.replaceAll(OPEN, '{').replaceAll(COMMA, ',').replaceAll(CLOSE, '}'));
}
