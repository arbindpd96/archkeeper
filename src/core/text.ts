/** Orders strings by UTF-16 code units, the same on every OS and locale, unlike `localeCompare`. */
export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * A regex character-class body (for the `u` flag) of what may erase, move or disguise text where a terminal
 * prints it: control characters (C0, DEL and C1, so ESC and CSI), line separators and bidirectional overrides.
 */
export const UNPRINTABLE = String.raw`\p{Cc}\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069`;

const UNPRINTABLE_CHARACTER = new RegExp(`[${UNPRINTABLE}]`, 'gu');
const UNPRINTABLE_BUT_LINES = new RegExp(`(?![\\n\\t])[${UNPRINTABLE}]`, 'gu');

const unicodeEscape = (character: string): string =>
  `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;

/** Writes each {@link UNPRINTABLE} character as a JSON `\u` escape, so the text prints as one plain line. */
export function escapeUnprintable(text: string): string {
  return text.replace(UNPRINTABLE_CHARACTER, unicodeEscape);
}

/** {@link escapeUnprintable} for text of many lines: line feeds and tabs stay, every other such character is escaped. */
export function escapeUnprintableKeepingLines(text: string): string {
  return text.replace(UNPRINTABLE_BUT_LINES, unicodeEscape);
}

/**
 * Quotes a path, key or value read from a file or the lock for a message: JSON quoting with every
 * {@link UNPRINTABLE} character escaped, so a crafted value cannot move, erase or disguise what a terminal prints.
 */
export function quoted(text: string): string {
  return escapeUnprintable(JSON.stringify(text));
}

/** True when a parsed JSON value is an object, not an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text that starts a file with a byte-order mark. */
export const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

/** Converts CRLF and CR line endings to LF and changes nothing else. */
export function toLf(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/** Converts CRLF and CR line endings to LF and ends the text with exactly one LF unless it is empty. */
export function asLfText(text: string): string {
  const lf = toLf(text);
  if (lf === '') return lf;
  return lf.endsWith('\n') ? lf : `${lf}\n`;
}
