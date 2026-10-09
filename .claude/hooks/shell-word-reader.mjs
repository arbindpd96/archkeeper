import { readAnsiCQuote } from './ansi-c-quote.mjs';

const METACHARACTERS = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);
const WORD_PART_READERS = new Map([
  ['\\', 'readEscape'],
  ["'", 'readSingleQuoted'],
  ['"', 'readDoubleQuoted'],
  ['`', 'readBackticks'],
  ['$', 'readDollar'],
  ['<', 'readSubstitution'],
  ['>', 'readSubstitution'],
]);
const QUOTING_CHARACTERS = new Set(['\\', "'", '"']);
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);
const BACKTICK_ESCAPES = new Set(['`', '\\', '$']);
const BRACE_DEPTH = new Map(Object.entries({ '{': 1, '}': -1 }));
const BRACE_SYNTAX = new Set(['{', ',', '}']);
const UNQUOTED_IFS = /^\$\{?IFS\b/;
const EXPANSION_START = /^[\w({@*#?$!-]/;
const ASSIGNMENT_PREFIX = /^[A-Za-z_]\w*\+?=/;

/** Raised when a command is malformed or parses differently across shells, so it cannot be judged. */
export class ShellSyntaxError extends Error {
  name = 'ShellSyntaxError';
}

/**
 * Reads one shell word at the cursor: quotes, escapes, $'...', parameter expansions and substitutions. Subclasses
 * provide `nested()` and `parseSequence()`, which parse substitution bodies in place from the same cursor.
 */
export class WordReader {
  constructor(source, context) {
    this.src = source;
    this.pos = 0;
    this.context = context;
  }

  fail(problem) {
    throw new ShellSyntaxError(problem);
  }

  atWordEnd() {
    const char = this.src[this.pos];
    const processSubstitution = (char === '<' || char === '>') && this.src[this.pos + 1] === '(';
    return this.pos >= this.src.length || (METACHARACTERS.has(char) && !processSubstitution);
  }

  readWord(seq) {
    const word = { text: '', quoted: false, braces: [], splits: false };
    while (!this.atWordEnd()) word.text += this.readWordPart(seq, word);
    return word;
  }

  readWordPart(seq, word) {
    const char = this.src[this.pos];
    const reader = WORD_PART_READERS.get(char);
    if (QUOTING_CHARACTERS.has(char)) word.quoted = true;
    if (reader) return this[reader](seq, word);
    if (BRACE_SYNTAX.has(char)) word.braces.push(word.text.length);
    this.pos += 1;
    return char;
  }

  readEscape() {
    const next = this.src[this.pos + 1] ?? '\\';
    this.pos = Math.min(this.pos + 2, this.src.length);
    return next === '\n' ? '' : next;
  }

  readSingleQuoted() {
    const end = this.src.indexOf("'", this.pos + 1);
    if (end === -1) this.fail('an unterminated single quote');
    const text = this.src.slice(this.pos + 1, end);
    this.pos = end + 1;
    return text;
  }

  readDoubleQuoted(seq) {
    let text = '';
    this.pos += 1;
    while (this.src[this.pos] !== '"') {
      if (this.pos >= this.src.length) this.fail('an unterminated double quote');
      text += this.readDoubleQuotedPart(seq);
    }
    this.pos += 1;
    return text;
  }

  readDoubleQuotedPart(seq) {
    const char = this.src[this.pos];
    if (char === '`') return this.readBackticks(seq);
    if (char === '$') return this.readDollar(seq, null);
    const next = this.src[this.pos + 1];
    const escaped = char === '\\' && DOUBLE_QUOTE_ESCAPES.has(next);
    this.pos += escaped ? 2 : 1;
    if (!escaped) return char;
    return next === '\n' ? '' : next;
  }

  readDollar(seq, word) {
    const next = this.src[this.pos + 1] ?? '';
    if (word && (next === "'" || next === '"')) return this.readDollarQuote(seq, word, next);
    if (word && EXPANSION_START.test(next)) this.markUnquotedExpansion(word);
    if (next === '(') return this.readSubstitution(seq);
    if (next === '{') return this.readBraced(seq, word);
    this.pos += 1;
    return '$';
  }

  readDollarQuote(seq, word, next) {
    word.quoted = true;
    if (next === "'") return this.readAnsiC();
    this.pos += 1;
    return this.readDoubleQuoted(seq);
  }

  // An unquoted expansion is split into words at run time; `rm${IFS}-rf${IFS}/` would hide its real arguments.
  markUnquotedExpansion(word) {
    word.splits = true;
    const assignment = ASSIGNMENT_PREFIX.test(word.text);
    if (!assignment && UNQUOTED_IFS.test(this.src.slice(this.pos, this.pos + 6)))
      this.fail('an unquoted $IFS');
  }

  readSubstitution(seq) {
    const start = this.pos;
    this.pos += 2;
    this.nested(seq, seq.cmd.subs, () => this.parseSequence(')'));
    return this.src.slice(start, this.pos);
  }

  readBackticks(seq, word) {
    const start = this.pos;
    if (word) word.splits = true;
    let body = '';
    this.pos += 1;
    while (this.src[this.pos] !== '`') {
      if (this.pos >= this.src.length) this.fail('an unterminated backtick');
      if (this.src[this.pos] === '\\' && BACKTICK_ESCAPES.has(this.src[this.pos + 1])) this.pos += 1;
      body += this.src[this.pos];
      this.pos += 1;
    }
    this.pos += 1;
    this.nested(seq, seq.cmd.subs, () => new this.constructor(body, this.context).parseSequence(null));
    return this.src.slice(start, this.pos);
  }

  readBraced(seq, word) {
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

  readBracedPart(seq, word) {
    const char = this.src[this.pos];
    // Inside "${...}" bash honours single quotes but zsh and dash do not, so the closing brace is ambiguous.
    if (char === "'" && !word) this.fail('a single quote inside a double-quoted ${...}');
    if (char === "'") this.readSingleQuoted();
    else if (char === '"') this.readDoubleQuoted(seq);
    else if (char === '`') this.readBackticks(seq);
    else if (char === '$') this.readDollar(seq, word);
    else this.pos += char === '\\' ? 2 : 1;
    return BRACE_DEPTH.get(char) ?? 0;
  }

  readAnsiC() {
    const { text, end, problem } = readAnsiCQuote(this.src, this.pos);
    if (problem) this.fail(problem);
    this.pos = end;
    return text;
  }
}
