/** Orders strings by UTF-16 code units, the same on every OS and locale, unlike `localeCompare`. */
export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Converts CRLF and CR line endings to LF and ends the text with exactly one LF unless it is empty. */
export function asLfText(text: string): string {
  const lf = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  if (lf === '') return lf;
  return lf.endsWith('\n') ? lf : `${lf}\n`;
}
