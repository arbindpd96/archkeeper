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
