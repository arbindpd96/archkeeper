import { Lexer, type Token, type Tokens, type TokensList, Tokenizer } from 'marked';

/**
 * The most lexing work, in estimated nanoseconds, the kit spends on one memory file before it gives up and
 * counts no import. marked is superlinear on some texts (a paragraph of `*a `, a list item of many lazy lines,
 * paragraphs broken off by rules, deep nesting), where Claude Code itself would take seconds. The estimate bounds
 * only the costs it models: on the maintainer's Mac the slowest of about 35 such shapes, each from 1 to 300 kB,
 * took about 90 ms, and every real Markdown file tried, up to 150 kB, stays below it.
 */
const MAX_WORK = 100_000_000;
/** marked recurses once per nested list, quote, emphasis or link; past this depth the kit counts nothing. */
const MAX_DEPTH = 64;
/** The cost of one call that lexes blocks or inline text, and of each character it reads. */
const CALL = { block: 2000, inline: 1000, perChar: 200 } as const;
/**
 * The superlinear costs, each per unit of what it multiplies: a list item's text rule rescans the rest of its run
 * of lines at each line; a paragraph broken off by a rule or one-line HTML has the next one rescan the run; a
 * quote's lazy lines each copy the quote's remaining lines; a last line that opens with `~~~` backtracks over
 * itself; a nested quote is re-read per level; an emphasis opener scans the delimiter runs after it; and a code
 * span opener, a tag or a masked span scans or copies the rest of the inline text.
 */
const RATE = {
  itemLine: 5,
  paragraphBreak: 3,
  quoteBreak: 0.5,
  tildeTail: 0.5,
  emphasisRun: 60,
  scan: 3,
  tag: 0.5,
  mask: 0.3,
  quoteChar: 20,
} as const;

const BLANK = /^[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const TILDE_FENCE = /^ {0,3}~~~/;
const PARAGRAPH_BREAK =
  /^ {0,3}(?:(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$|<(?:!--|script|pre|style|textarea))/i;

/** Thrown inside the lexer when a text would take more work than the kit spends on it. */
class WorkRefused extends Error {}

/** What the runs of non-blank lines make marked rescan: each run's length times its lines, and times its breaks. */
interface Rescans {
  readonly lines: number;
  readonly breaks: number;
}

function rescannedRuns(lines: readonly string[]): Rescans {
  const total = { lines: 0, breaks: 0 };
  const run = { lines: 0, breaks: 0, length: 0 };
  for (const line of [...lines, '']) {
    if (BLANK.test(line)) {
      total.lines += run.lines * run.length;
      total.breaks += run.breaks * run.length;
      Object.assign(run, { lines: 0, breaks: 0, length: 0 });
    } else {
      run.lines += 1;
      run.breaks += PARAGRAPH_BREAK.test(line) ? 1 : 0;
      run.length += line.length + 1;
    }
  }
  return total;
}

/**
 * The superlinear block work of `src`. A top-level paragraph takes its run of lines at once, unless a rule or a
 * one-line HTML block breaks it off, after which the next paragraph's setext heading test rescans the run again.
 */
function blockWork(src: string, top: boolean): number {
  const lines = src.split('\n');
  const rescans = rescannedRuns(lines);
  const quoteBreaks = lines.filter(
    (line, index) => index > 0 && QUOTE.test(lines[index - 1] ?? '') && !QUOTE.test(line),
  );
  const last = lines.at(-1) ?? '';
  const tail = TILDE_FENCE.test(last) ? last.length ** 2 : 0;
  return (
    (top ? RATE.paragraphBreak * rescans.breaks : RATE.itemLine * rescans.lines) +
    RATE.quoteBreak * quoteBreaks.length * lines.length +
    RATE.tildeTail * tail
  );
}

function matches(src: string, pattern: RegExp): string[] {
  return src.match(pattern) ?? [];
}

/** The superlinear inline work of `src`: what its delimiters, code spans, tags and masked spans may scan. */
function inlineWork(src: string): number {
  const runs = matches(src, /\*+|_+/g);
  const delimiters = runs.reduce((sum, run) => sum + run.length, 0);
  const tickLengths = new Set(matches(src, /`+/g).map((run) => run.length)).size;
  const tags = matches(src, /</g).length;
  const masked = matches(src, /[`<[\\]/g).length;
  return (
    RATE.emphasisRun * runs.length ** 2 +
    src.length * (RATE.scan * (delimiters + tickLengths) + RATE.tag * tags + RATE.mask * masked)
  );
}

/** The work and nesting depth one lexing has used, refused past the kit's limits. */
class WorkBudget {
  #work = 0;
  #depth = 0;

  spend(work: number): void {
    this.#work += work;
    if (this.#work > MAX_WORK) throw new WorkRefused('the text takes more lexing work than the kit spends');
  }

  nested<T>(lex: () => T): T {
    if (this.#depth >= MAX_DEPTH) throw new WorkRefused('the text nests deeper than the kit reads');
    this.#depth += 1;
    try {
      return lex();
    } finally {
      this.#depth -= 1;
    }
  }
}

/**
 * marked's Tokenizer, which counts the quote it reads before it reads it: a quote whose last block is a quote
 * re-reads its remaining lines as a new quote, once per level, without lexing blocks in between.
 */
class BoundedTokenizer extends Tokenizer {
  readonly #budget: WorkBudget;

  constructor(budget: WorkBudget) {
    super();
    this.#budget = budget;
  }

  override blockquote(src: string): Tokens.Blockquote | undefined {
    const quote = QUOTE.test(src) ? this.rules.block.blockquote.exec(src) : null;
    if (quote !== null) this.#budget.spend(RATE.quoteChar * quote[0].length);
    return super.blockquote(src);
  }
}

/**
 * marked's Lexer, which counts its work before each call that lexes blocks or inline text and refuses past the
 * budget or the depth. It lexes inline text without an `@` too: such text holds no import, but Claude Code lexes
 * it, and nesting deep enough there overflows its stack and makes it skip the whole file.
 */
class BoundedLexer extends Lexer {
  readonly #budget: WorkBudget;

  constructor(budget: WorkBudget) {
    super({ gfm: false, tokenizer: new BoundedTokenizer(budget) });
    this.#budget = budget;
  }

  override blockTokens(src: string, tokens?: Token[], lastParagraphClipped?: boolean): Token[];
  override blockTokens(src: string, tokens?: TokensList, lastParagraphClipped?: boolean): TokensList;
  override blockTokens(src: string, tokens: Token[] = [], lastParagraphClipped = false): Token[] {
    this.#budget.spend(CALL.block + CALL.perChar * src.length);
    this.#budget.spend(blockWork(src, this.state.top));
    return this.#budget.nested(() => super.blockTokens(src, tokens, lastParagraphClipped));
  }

  override inlineTokens(src: string, tokens: Token[] = []): Token[] {
    this.#budget.spend(CALL.inline + CALL.perChar * src.length);
    this.#budget.spend(inlineWork(src));
    return this.#budget.nested(() => super.inlineTokens(src, tokens));
  }
}

/**
 * Lexes `text` as Claude Code 2.1.295 does, with marked's Lexer and `{ gfm: false }`, or returns undefined where
 * Claude Code would read no import from it: marked throws (an "Infinite loop on byte" error, or a stack overflow
 * on deep nesting), which makes Claude Code skip the whole file, or the text takes more work than the kit spends.
 * Every error is taken, whatever its type: an error marked throws on a hostile text cannot be told apart by type
 * from a bug in the subclasses above, and init must not fail on a file it only reads; such a bug would show as a
 * redundant import line, which the tests of texts that do import catch.
 */
export function lexedTokens(text: string): TokensList | undefined {
  try {
    return new BoundedLexer(new WorkBudget()).lex(text);
  } catch {
    return undefined;
  }
}
