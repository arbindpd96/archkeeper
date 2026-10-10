const NAMED_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['a', '\x07'],
  ['b', '\b'],
  ['e', '\x1b'],
  ['E', '\x1b'],
  ['f', '\f'],
  ['v', '\v'],
]);
const LITERAL_ESCAPES: ReadonlySet<string> = new Set(['\\', '"', '?']);
const NUMERIC_ESCAPE =
  /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c([\s\S]))/;

interface Decoded {
  readonly decoded: string;
  readonly length: number;
}

/** A decoded `$'...'` string and the index after its closing quote, or why it cannot be read. */
export type AnsiCQuote = { readonly text: string; readonly end: number } | { readonly problem: string };

function decodeNumeric(match: RegExpExecArray): string {
  const [, hex, utf16, utf32, octal, control] = match;
  if (control !== undefined) return String.fromCharCode(control.charCodeAt(0) & 0x1f);
  const code = octal === undefined ? parseInt(hex ?? utf16 ?? utf32 ?? '0', 16) : parseInt(octal, 8);
  return code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function decodeEscape(tail: string): Decoded {
  const numeric = NUMERIC_ESCAPE.exec(tail);
  if (numeric) return { decoded: decodeNumeric(numeric), length: numeric[0].length };
  const name = tail.slice(0, 1);
  const decoded = LITERAL_ESCAPES.has(name) ? name : (NAMED_ESCAPES.get(name) ?? `\\${name}`);
  return { decoded, length: 1 };
}

/** Decodes backslash escapes (`\n`, `\x72`, `\162`, `\u…`) the way printf and `echo -e` print them. */
export function decodeEscapes(text: string): string {
  let decoded = '';
  let pos = 0;
  while (pos < text.length) {
    const backslash = text.indexOf('\\', pos);
    if (backslash === -1) return decoded + text.slice(pos);
    const escape = decodeEscape(text.slice(backslash + 1, backslash + 10));
    decoded += text.slice(pos, backslash) + escape.decoded;
    pos = backslash + 1 + escape.length;
  }
  return decoded;
}

/**
 * Decodes a bash or zsh `$'...'` string whose `$` is at `start`: its text and the index after the closing quote,
 * or a problem when the string is unterminated or ambiguous.
 */
export function readAnsiCQuote(source: string, start: number): AnsiCQuote {
  let text = '';
  let pos = start + 2;
  while (source[pos] !== "'") {
    if (pos >= source.length) return { problem: "an unterminated $'...' string" };
    if (source[pos] === '\\') {
      const tail = source.slice(pos + 1, pos + 10);
      // bash and zsh read on after \' but POSIX sh ends the string there, so what follows is ambiguous.
      if (tail.startsWith("'")) return { problem: "an escaped quote inside $'...'" };
      const { decoded, length } = decodeEscape(tail);
      text += decoded;
      pos += 1 + length;
    } else {
      text += source[pos] ?? '';
      pos += 1;
    }
  }
  return { text, end: pos + 1 };
}
