import { readAnsiCQuote } from './ansi-c-quote.js';
import { isAssignment, ShellSyntaxError } from './syntax.js';
import type { RawCommand } from './types.js';

const METACHARACTERS: ReadonlySet<string> = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);
const QUOTING_CHARACTERS: ReadonlySet<string> = new Set(['\\', "'", '"']);
const DOUBLE_QUOTE_ESCAPES: ReadonlySet<string> = new Set(['$', '`', '"', '\\', '\n']);
const BACKTICK_ESCAPES: ReadonlySet<string> = new Set(['`', '\\', '$']);
const BRACE_DEPTH: ReadonlyMap<string, number> = new Map([
  ['{', 1],
  ['}', -1],
]);
const BRACE_SYNTAX: ReadonlySet<string> = new Set(['{', ',', '}']);
const UNQUOTED_IFS = /^\$\{?IFS\b/;
const EXPANSION_START = /^[\w({@*#?$!-]/;

/** A pipeline as the parser builds it: its id and the stage the next command takes. */
export interface Pipe {
  pipeline: number;
  stage: number;
}

/** The command list being read up to its terminator, such as `)` or `fi`. */
export interface Sequence {
  cmd: RawCommand;
  pipe: Pipe;
  skipName: boolean;
  closed: boolean;
  readonly terminator: string | null;
}

/** One shell word being read: its text without quotes and what the shell does with it at run time. */
export interface Word {
  text: string;
  quoted: boolean;
  braces: number[];
  splits: boolean;
  expands: boolean;
}

/** An enclosing group or substitution: its pipeline position and the list that collects the commands it runs. */
export interface Frame {
  readonly pipe: Pipe;
  readonly subs: RawCommand[] | null;
}

/** What every reader of one command line shares: the commands found, the open frames and the pipeline ids. */
export interface ParseContext {
  readonly commands: RawCommand[];
  readonly frames: Frame[];
  pipelines: number;
}

type PartReader = (reader: WordReader, seq: Sequence, word: Word) => string;

const WORD_PARTS: ReadonlyMap<string, PartReader> = new Map<string, PartReader>([
  ['\\', (reader) => reader.readEscape()],
  ["'", (reader) => reader.readSingleQuoted()],
  ['"', (reader, seq) => reader.readDoubleQuoted(seq)],
  ['`', (reader, seq, word) => reader.readBackticks(seq, word)],
  ['$', (reader, seq, word) => reader.readDollar(seq, word)],
  ['<', (reader, seq) => reader.readSubstitution(seq)],
  ['>', (reader, seq) => reader.readSubstitution(seq)],
]);

function closingQuote(src: string, open: number): number {
  const quote = src[open];
  for (let pos = open + 1; pos < src.length; pos += 1) {
    if (src[pos] === '\\' && quote !== "'") pos += 1;
    else if (src[pos] === quote) return pos;
  }
  return -1;
}

// The index after the quoted string, escape or character at `pos`; the end for an unterminated quote.
function skipPast(src: string, pos: number): number {
  const char = src[pos];
  if (char === '\\') return pos + 2;
  if (char !== "'" && char !== '"' && char !== '`') return pos + 1;
  const close = closingQuote(src, pos);
  return close === -1 ? src.length : close + 1;
}

/**
 * The index after the `))` that closes the arithmetic expansion whose body starts at `from`, or undefined when a
 * lone `)` closes it first, which bash then reads as `$( (…) )`, a command substitution of a subshell.
 */
function arithmeticEnd(src: string, from: number): number | undefined {
  let depth = 0;
  for (let pos = from; pos < src.length; pos = skipPast(src, pos)) {
    const char = src[pos];
    if (char === '(') depth += 1;
    else if (char === ')' && depth > 0) depth -= 1;
    else if (char === ')') return src[pos + 1] === ')' ? pos + 2 : undefined;
  }
  return undefined;
}

/**
 * Reads one shell word at the cursor: quotes, escapes, $'...', parameter and arithmetic expansions and
 * substitutions. Subclasses parse substitution bodies in place from the same cursor, so the source is scanned once.
 */
export abstract class WordReader {
  protected readonly src: string;
  protected readonly context: ParseContext;
  protected pos = 0;
  protected expansions = 0;

  constructor(source: string, context: ParseContext) {
    this.src = source;
    this.context = context;
  }

  /** Runs `parse` inside a new frame, whose commands also go to `subs` when it is given. */
  abstract nested(seq: Sequence, subs: RawCommand[] | null, parse: () => void): void;

  /** Parses commands up to `terminator`, or to the end of the source when it is null. */
  abstract parseSequence(terminator: string | null): void;

  /** A reader of the same kind over other source text, sharing this one's context. */
  protected abstract child(source: string): WordReader;

  /** Throws the ShellSyntaxError that names what could not be read. */
  fail(problem: string): never {
    throw new ShellSyntaxError(problem);
  }

  /** Tells whether the cursor is past the last word character: at the end or on a metacharacter. */
  atWordEnd(): boolean {
    const char = this.src[this.pos] ?? '';
    const processSubstitution = (char === '<' || char === '>') && this.src[this.pos + 1] === '(';
    return this.pos >= this.src.length || (METACHARACTERS.has(char) && !processSubstitution);
  }

  /** Reads the word at the cursor. */
  readWord(seq: Sequence): Word {
    const word: Word = { text: '', quoted: false, braces: [], splits: false, expands: false };
    const before = this.expansions;
    while (!this.atWordEnd()) word.text += this.readWordPart(seq, word);
    word.expands = this.expansions > before;
    return word;
  }

  private readWordPart(seq: Sequence, word: Word): string {
    const char = this.src[this.pos] ?? '';
    const reader = WORD_PARTS.get(char);
    if (QUOTING_CHARACTERS.has(char)) word.quoted = true;
    if (reader) return reader(this, seq, word);
    if (BRACE_SYNTAX.has(char)) word.braces.push(word.text.length);
    this.pos += 1;
    return char;
  }

  /** Reads a backslash and the character it escapes; an escaped newline joins two lines. */
  readEscape(): string {
    const next = this.src[this.pos + 1] ?? '\\';
    this.pos = Math.min(this.pos + 2, this.src.length);
    return next === '\n' ? '' : next;
  }

  /** Reads a single-quoted string, whose text is literal. */
  readSingleQuoted(): string {
    const end = this.src.indexOf("'", this.pos + 1);
    if (end === -1) this.fail('an unterminated single quote');
    const text = this.src.slice(this.pos + 1, end);
    this.pos = end + 1;
    return text;
  }

  /** Reads a double-quoted string, parsing the substitutions in it. */
  readDoubleQuoted(seq: Sequence): string {
    let text = '';
    this.pos += 1;
    while (this.src[this.pos] !== '"') {
      if (this.pos >= this.src.length) this.fail('an unterminated double quote');
      text += this.readDoubleQuotedPart(seq);
    }
    this.pos += 1;
    return text;
  }

  private readDoubleQuotedPart(seq: Sequence): string {
    const char = this.src[this.pos] ?? '';
    if (char === '`') return this.readBackticks(seq, null);
    if (char === '$') return this.readDollar(seq, null);
    const next = this.src[this.pos + 1] ?? '';
    const escaped = char === '\\' && DOUBLE_QUOTE_ESCAPES.has(next);
    this.pos += escaped ? 2 : 1;
    if (!escaped) return char;
    return next === '\n' ? '' : next;
  }

  /** Reads what follows a `$`; `word` is null inside double quotes and other quoted contexts. */
  readDollar(seq: Sequence, word: Word | null): string {
    const next = this.src[this.pos + 1] ?? '';
    if (word && (next === "'" || next === '"')) return this.readDollarQuote(seq, word, next);
    const expansion = EXPANSION_START.test(next);
    if (expansion) this.expansions += 1;
    if (word && expansion) this.markUnquotedExpansion(word);
    if (next === '(') return this.readParenthesized(seq);
    if (next === '{') return this.readBraced(seq, word);
    this.pos += 1;
    return '$';
  }

  private readDollarQuote(seq: Sequence, word: Word, next: string): string {
    word.quoted = true;
    if (next === "'") return this.readAnsiC();
    this.pos += 1;
    return this.readDoubleQuoted(seq);
  }

  // An unquoted expansion is split into words at run time; `rm${IFS}-rf${IFS}/` would hide its real arguments.
  private markUnquotedExpansion(word: Word): void {
    word.splits = true;
    if (!isAssignment(word.text) && UNQUOTED_IFS.test(this.src.slice(this.pos, this.pos + 6))) {
      this.fail('an unquoted $IFS');
    }
  }

  // `$((1 << 2))` is arithmetic, not a substitution of a subshell (#31), but a substitution inside it still runs.
  private readParenthesized(seq: Sequence): string {
    const end = this.src[this.pos + 2] === '(' ? arithmeticEnd(this.src, this.pos + 3) : undefined;
    return end === undefined ? this.readSubstitution(seq) : this.readArithmetic(seq, end);
  }

  private readArithmetic(seq: Sequence, end: number): string {
    const start = this.pos;
    this.pos += 3;
    this.nested(seq, null, () => {
      while (this.pos < end - 2) this.readArithmeticPart(seq);
    });
    if (this.pos !== end - 2) this.fail('an arithmetic expansion that reads differently across shells');
    this.pos = end;
    return this.src.slice(start, end);
  }

  private readArithmeticPart(seq: Sequence): void {
    const char = this.src[this.pos];
    if (char === '$') this.readDollar(seq, null);
    else if (char === '`') this.readBackticks(seq, null);
    else if (char === '"') this.readDoubleQuoted(seq);
    else if (char === "'") this.readSingleQuoted();
    else this.pos += char === '\\' ? 2 : 1;
  }

  /** Reads `$(...)`, `<(...)` or `>(...)`, parsing its commands as subs of the current command. */
  readSubstitution(seq: Sequence): string {
    const start = this.pos;
    this.expansions += 1;
    this.pos += 2;
    this.nested(seq, seq.cmd.subs, () => {
      this.parseSequence(')');
    });
    return this.src.slice(start, this.pos);
  }

  /** Reads a backtick substitution and parses its unescaped body. */
  readBackticks(seq: Sequence, word: Word | null): string {
    const start = this.pos;
    this.expansions += 1;
    if (word) word.splits = true;
    let body = '';
    this.pos += 1;
    while (this.src[this.pos] !== '`') {
      if (this.pos >= this.src.length) this.fail('an unterminated backtick');
      if (this.src[this.pos] === '\\' && BACKTICK_ESCAPES.has(this.src[this.pos + 1] ?? '')) this.pos += 1;
      body += this.src[this.pos] ?? '';
      this.pos += 1;
    }
    this.pos += 1;
    this.nested(seq, seq.cmd.subs, () => {
      this.child(body).parseSequence(null);
    });
    return this.src.slice(start, this.pos);
  }

  private readBraced(seq: Sequence, word: Word | null): string {
    const start = this.pos;
    this.pos += 2;
    this.nested(seq, null, () => {
      let depth = 1;
      while (depth > 0) {
        if (this.pos >= this.src.length) this.fail('an unterminated ${...}');
        depth += this.readBracedPart(seq, word);
      }
    });
    return this.src.slice(start, this.pos);
  }

  private readBracedPart(seq: Sequence, word: Word | null): number {
    const char = this.src[this.pos] ?? '';
    // Inside "${...}" bash honours single quotes but zsh and dash do not, so the closing brace is ambiguous.
    if (char === "'" && !word) this.fail('a single quote inside a double-quoted ${...}');
    if (char === "'") this.readSingleQuoted();
    else if (char === '"') this.readDoubleQuoted(seq);
    else if (char === '`') this.readBackticks(seq, null);
    else if (char === '$') this.readDollar(seq, word);
    else this.pos += char === '\\' ? 2 : 1;
    return BRACE_DEPTH.get(char) ?? 0;
  }

  private readAnsiC(): string {
    const quote = readAnsiCQuote(this.src, this.pos);
    if ('problem' in quote) this.fail(quote.problem);
    this.pos = quote.end;
    return quote.text;
  }
}
