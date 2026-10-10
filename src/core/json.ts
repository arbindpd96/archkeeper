import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser';
import type { Finding } from './errors.js';
import { BYTE_ORDER_MARK } from './text.js';

/** A parsed JSON document, or the first syntax error in it. */
export type JsonResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly finding: Finding };

const STRICT = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };

/** A jsonc-parser error code in words, such as `property name expected`. */
export function parseErrorWords(error: ParseError['error']): string {
  return printParseErrorCode(error)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/** The 1-based line and column of `offset` in `text`, as `line 3, column 7`. */
export function lineAndColumn(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return `line ${String(line)}, column ${String(offset - before.lastIndexOf('\n'))}`;
}

// JSON.parse names no position for some errors (`Unexpected token '}', "…" is not valid JSON`), so the
// location comes from jsonc-parser. The value itself comes from JSON.parse, which keeps a `__proto__` key
// as plain data instead of setting the prototype of the object it builds.
function syntaxFinding(text: string, fallback: string): Finding {
  const errors: ParseError[] = [];
  parse(text, errors, STRICT);
  const [first] = errors;
  if (first === undefined) {
    return { location: '', problem: `is not valid JSON (${fallback})`, hint: 'fix the JSON syntax' };
  }
  return {
    location: lineAndColumn(text, first.offset),
    problem: `is not valid JSON (${parseErrorWords(first.error)})`,
    hint: 'fix the JSON at that spot; JSON allows no comments and no trailing commas',
  };
}

/** Parses a JSON document, ignoring a leading byte-order mark, and locates the first error when it is invalid. */
export function parseJson(text: string): JsonResult {
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch (error) {
    return {
      ok: false,
      finding: syntaxFinding(source, error instanceof Error ? error.message : String(error)),
    };
  }
}

/** True when a parsed JSON value is an object, not an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
