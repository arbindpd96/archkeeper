import { isAssignment } from './syntax.js';
import { newCommand, type RawCommand } from './types.js';
import { type ParseContext, type Pipe, type Sequence, type Word, WordReader } from './word-reader.js';

const MAX_NESTING = 32;

const OPERATORS: readonly string[] = [
  ...['&&', '&>>', '&>', '||', '|&', ';;', '<<<', '<<-', '<<', '<>', '<&', '>>', '>|', '>&'],
  ...['&', '|', ';', '<', '>', '(', ')', '\n'],
];
const REDIRECTS: ReadonlySet<string> = new Set([
  '&>>',
  '&>',
  '<<<',
  '<<-',
  '<<',
  '<>',
  '<&',
  '>>',
  '>|',
  '>&',
  '<',
  '>',
]);
const OUTPUT_REDIRECTS: ReadonlySet<string> = new Set(['&>>', '&>', '<>', '>>', '>|', '>&', '>']);
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  ...['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until'],
  ...['case', 'esac', 'for', 'select', 'function', 'coproc'],
]);
const COMPOUND_ENDS: ReadonlyMap<string, string> = new Map([
  ['{', '}'],
  ['if', 'fi'],
  ['case', 'esac'],
  ['for', 'done'],
  ['select', 'done'],
  ['while', 'done'],
  ['until', 'done'],
]);
const EMPTY_PARENS_END = /[ \t]*\)/y;
const ARRAY_BLANKS: ReadonlySet<string> = new Set([' ', '\t', '\n']);

interface PendingHeredoc {
  readonly delimiter: string;
  readonly stripTabs: boolean;
  readonly expands: boolean;
  readonly cmd: RawCommand;
  readonly pipe: Pipe;
}

// `2>err` and `3<&0` name a file descriptor, which is no word of the command.
function isDescriptorPrefix(word: Word, next: string | undefined): boolean {
  return !word.quoted && /^\d+$/.test(word.text) && (next === '<' || next === '>');
}

function opensArray(word: Word, next: string | undefined): boolean {
  return next === '(' && isAssignment(word.text) && word.text.endsWith('=');
}

/**
 * Nested constructs ($(...), <(...), groups) are parsed in place from the same cursor, so the source is scanned
 * once; only backtick bodies and here-documents are scanned again, and their escaping keeps that bounded.
 */
class Parser extends WordReader {
  private readonly pendingHeredocs: PendingHeredoc[] = [];
  private lastWordEnd = -1;

  protected child(source: string): Parser {
    return new Parser(source, this.context);
  }

  parseSequence(terminator: string | null): void {
    const seq: Sequence = {
      cmd: newCommand(),
      pipe: this.newPipe(),
      skipName: false,
      closed: false,
      terminator,
    };
    while (this.step(seq));
    if (terminator !== null && !seq.closed) this.fail(`a missing closing "${terminator}"`);
    this.finishCommand(seq);
    if (terminator === null && this.pendingHeredocs.length > 0) this.fail('an unterminated here-document');
  }

  nested(seq: Sequence, subs: RawCommand[] | null, parse: () => void): void {
    const { frames } = this.context;
    if (frames.length >= MAX_NESTING) this.fail('nesting that is too deep');
    frames.push({ pipe: { ...seq.pipe }, subs });
    parse();
    frames.pop();
  }

  private newPipe(): Pipe {
    this.context.pipelines += 1;
    return { pipeline: this.context.pipelines, stage: 0 };
  }

  private step(seq: Sequence): boolean {
    this.skipBlanks();
    const char = this.src[this.pos];
    if (char === undefined) return false;
    seq.closed = char === ')' && seq.terminator === ')';
    if (seq.closed) this.pos += 1;
    else if (char === '#') this.pos = this.lineEnd();
    else if (this.atWordEnd()) this.applyOperator(seq, this.operatorAt());
    else this.addWord(seq);
    return !seq.closed;
  }

  private operatorAt(): string {
    return (
      OPERATORS.find((operator) => this.src.startsWith(operator, this.pos)) ??
      this.fail('an unknown operator')
    );
  }

  private skipBlanks(): void {
    for (;;) {
      if (this.src[this.pos] === ' ' || this.src[this.pos] === '\t') this.pos += 1;
      else if (this.src.startsWith('\\\n', this.pos)) this.pos += 2;
      else return;
    }
  }

  private lineEnd(): number {
    const end = this.src.indexOf('\n', this.pos);
    return end === -1 ? this.src.length : end;
  }

  private applyOperator(seq: Sequence, operator: string): void {
    const adjacentToWord = this.lastWordEnd === this.pos;
    this.pos += operator.length;
    if (REDIRECTS.has(operator)) {
      this.redirect(seq, operator);
    } else if (operator === ')' && seq.terminator === 'esac') {
      // The words before `)` in a case statement are patterns, not a command.
      seq.cmd = newCommand();
    } else {
      seq.cmd.definesFunction ||= operator === '(' && seq.cmd.argv.length === 1 && this.emptyParensFollow();
      this.finishCommand(seq);
      this.afterCommand(seq, operator, adjacentToWord);
    }
  }

  // Called just after a `(`: `name()` and `name ( )` define a function.
  private emptyParensFollow(): boolean {
    EMPTY_PARENS_END.lastIndex = this.pos;
    return EMPTY_PARENS_END.test(this.src);
  }

  private afterCommand(seq: Sequence, operator: string, adjacentToWord: boolean): void {
    if (operator === '(') this.group(seq, adjacentToWord);
    else if (operator === '|' || operator === '|&') seq.pipe.stage += 1;
    else seq.pipe = this.newPipe();
    if (operator === '\n') this.readHeredocBodies();
  }

  private group(seq: Sequence, adjacentToWord: boolean): void {
    // zsh glob qualifiers such as *(e:'cmd':) run code that bash would reject, so refuse to guess.
    if (adjacentToWord && !this.emptyParensFollow()) {
      this.fail('a glob qualifier or extglob: a word directly followed by "("');
    }
    this.nested(seq, null, () => {
      this.parseSequence(')');
    });
  }

  private finishCommand(seq: Sequence): void {
    const { cmd } = seq;
    seq.cmd = newCommand();
    seq.skipName = false;
    if (cmd.argv.length === 0 && cmd.redirects.length === 0) return;
    this.record(cmd, seq.pipe);
  }

  private record(cmd: RawCommand, pipe: Pipe): void {
    const { frames, commands } = this.context;
    cmd.pipes = [{ ...pipe }, ...frames.map((frame) => ({ ...frame.pipe }))];
    commands.push(cmd);
    for (const frame of frames) frame.subs?.push(cmd);
  }

  // `function name` is not a command, but rules need to know the name runs the body that follows.
  private recordFunctionName(seq: Sequence, name: string): void {
    const cmd = { ...newCommand(), argv: [name], braces: [[]], splits: [false], expands: [false] };
    cmd.definesFunction = true;
    this.record(cmd, seq.pipe);
  }

  private redirect(seq: Sequence, operator: string): void {
    this.skipBlanks();
    const { text, quoted } = this.readWord(seq);
    const stripTabs = operator === '<<-';
    if (operator === '<<' || stripTabs) {
      const heredoc = { delimiter: text, stripTabs, expands: !quoted };
      this.pendingHeredocs.push({ ...heredoc, cmd: seq.cmd, pipe: { ...seq.pipe } });
    } else {
      (operator === '<<<' ? seq.cmd.heredocs : seq.cmd.redirects).push(text);
      if (OUTPUT_REDIRECTS.has(operator)) seq.cmd.outputs.push(text);
    }
  }

  private readHeredocBodies(): void {
    for (const heredoc of this.pendingHeredocs.splice(0)) {
      const body = this.readHeredoc(heredoc);
      heredoc.cmd.heredocs.push(body);
      if (heredoc.expands) this.child(body).expandHeredoc(heredoc);
    }
  }

  // An unquoted delimiter means the shell runs $(...) and backticks inside the body.
  private expandHeredoc({ cmd, pipe }: PendingHeredoc): void {
    const seq: Sequence = { cmd, pipe, skipName: false, closed: false, terminator: null };
    while (this.pos < this.src.length) {
      const char = this.src[this.pos];
      if (char === '$') this.readDollar(seq, null);
      else if (char === '`') this.readBackticks(seq, null);
      else this.pos += char === '\\' ? 2 : 1;
    }
  }

  private readHeredoc({ delimiter, stripTabs }: PendingHeredoc): string {
    const lines: string[] = [];
    while (this.pos < this.src.length) {
      const end = this.lineEnd();
      const line = this.src.slice(this.pos, end);
      this.pos = Math.min(end + 1, this.src.length);
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) return lines.join('\n');
      lines.push(line);
    }
    return this.fail('an unterminated here-document');
  }

  private addWord(seq: Sequence): void {
    const word = this.readWord(seq);
    const next = this.src[this.pos];
    if (isDescriptorPrefix(word, next)) return;
    if (opensArray(word, next)) this.readArray(seq, word);
    if (seq.skipName) {
      seq.skipName = false;
      this.recordFunctionName(seq, word.text);
    } else if (!word.quoted && seq.cmd.argv.length === 0 && RESERVED_WORDS.has(word.text)) {
      this.addReservedWord(seq, word.text);
    } else {
      this.pushWord(seq, word);
    }
  }

  private pushWord(seq: Sequence, word: Word): void {
    seq.cmd.argv.push(word.text);
    seq.cmd.braces.push(word.braces);
    seq.cmd.splits.push(word.splits);
    seq.cmd.expands.push(word.expands);
    this.lastWordEnd = this.pos;
  }

  // `arr=(rm -rf ~)` assigns words, it runs nothing (#31); a substitution among them still runs.
  private readArray(seq: Sequence, word: Word): void {
    const start = this.pos;
    const before = this.expansions;
    this.pos += 1;
    for (;;) {
      this.skipArrayBlanks();
      const char = this.src[this.pos];
      if (char === undefined) this.fail('an unterminated array assignment');
      if (char === ')') break;
      if (char === '#') this.pos = this.lineEnd();
      else if (this.atWordEnd()) this.fail('an operator inside an array assignment');
      else this.readWord(seq);
    }
    this.pos += 1;
    word.text += this.src.slice(start, this.pos);
    word.expands ||= this.expansions > before;
  }

  private skipArrayBlanks(): void {
    while (ARRAY_BLANKS.has(this.src[this.pos] ?? '') || this.src.startsWith('\\\n', this.pos)) {
      this.pos += 1;
    }
  }

  private addReservedWord(seq: Sequence, word: string): void {
    const end = COMPOUND_ENDS.get(word);
    if (end !== undefined) {
      this.nested(seq, null, () => {
        this.parseSequence(end);
      });
    } else if (word === seq.terminator) {
      seq.closed = true;
    } else {
      seq.skipName = word === 'function';
    }
  }
}

/**
 * Splits shell source into simple commands (see RawCommand). A function name (`f() …` or `function f …`) is a
 * command with `definesFunction` set. Throws ShellSyntaxError for source it cannot read the way every shell does.
 */
export function tokenize(source: string): RawCommand[] {
  const context: ParseContext = { commands: [], frames: [], pipelines: 0 };
  new Parser(source, context).parseSequence(null);
  return context.commands;
}
