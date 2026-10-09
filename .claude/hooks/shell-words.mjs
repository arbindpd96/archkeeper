import { ShellSyntaxError, WordReader } from './shell-word-reader.mjs';

export { ShellSyntaxError };

const MAX_NESTING = 32;

const OPERATORS = '&& &>> &> || |& ;; <<< <<- << <> <& >> >| >& & | ; < > ( )'.split(' ').concat('\n');
const REDIRECTS = new Set('&>> &> <<< <<- << <> <& >> >| >& < >'.split(' '));
const RESERVED_WORDS = new Set(
  '! { } if then elif else fi do done while until case esac for select function coproc'.split(' '),
);
const EMPTY_PARENS_END = /[ \t]*\)/y;
const COMPOUND_ENDS = new Map(
  '{:} if:fi case:esac for:done select:done while:done until:done'.split(' ').map((pair) => pair.split(':')),
);

const newCommand = () => ({
  argv: [],
  braces: [],
  splits: [],
  expands: [],
  redirects: [],
  heredocs: [],
  subs: [],
  pipes: [],
});
const newPipe = () => ({ pipeline: {}, stage: 0 });

/**
 * Nested constructs ($(...), <(...), groups) are parsed in place from the same cursor, so the source is scanned
 * once; only backtick bodies are re-scanned, and their escaping keeps that bounded.
 */
class Parser extends WordReader {
  constructor(source, context) {
    super(source, context);
    this.pendingHeredocs = [];
    this.lastWordEnd = -1;
  }

  parseSequence(terminator) {
    const seq = { cmd: newCommand(), pipe: newPipe(), skipName: false, closed: false, terminator };
    let running = true;
    while (running) running = this.step(seq);
    if (terminator && !seq.closed) this.fail(`a missing closing "${terminator}"`);
    this.finishCommand(seq);
    if (!terminator && this.pendingHeredocs.length > 0) this.fail('an unterminated here-document');
  }

  step(seq) {
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

  operatorAt() {
    return OPERATORS.find((operator) => this.src.startsWith(operator, this.pos));
  }

  skipBlanks() {
    for (;;) {
      if (this.src[this.pos] === ' ' || this.src[this.pos] === '\t') this.pos += 1;
      else if (this.src.startsWith('\\\n', this.pos)) this.pos += 2;
      else return;
    }
  }

  lineEnd() {
    const end = this.src.indexOf('\n', this.pos);
    return end === -1 ? this.src.length : end;
  }

  applyOperator(seq, operator) {
    const adjacentToWord = this.lastWordEnd === this.pos;
    this.pos += operator.length;
    if (REDIRECTS.has(operator)) {
      this.redirect(seq, operator);
    } else if (operator === ')' && seq.terminator === 'esac') {
      // The words before `)` in a case statement are patterns, not a command.
      seq.cmd = newCommand();
    } else {
      const definesFunction = operator === '(' && seq.cmd.argv.length === 1 && this.emptyParensFollow();
      if (definesFunction) seq.cmd.definesFunction = true;
      this.finishCommand(seq);
      this.afterCommand(seq, operator, adjacentToWord);
    }
  }

  // Called just after a `(`: `name()` and `name ( )` define a function.
  emptyParensFollow() {
    EMPTY_PARENS_END.lastIndex = this.pos;
    return EMPTY_PARENS_END.test(this.src);
  }

  afterCommand(seq, operator, adjacentToWord) {
    if (operator === '(') this.group(seq, adjacentToWord);
    else if (operator === '|' || operator === '|&') seq.pipe.stage += 1;
    else seq.pipe = newPipe();
    if (operator === '\n') this.readHeredocBodies();
  }

  group(seq, adjacentToWord) {
    // zsh glob qualifiers such as *(e:'cmd':) run code that bash would reject, so refuse to guess.
    if (adjacentToWord && !this.emptyParensFollow() && this.src[this.pos - 2] !== '=') {
      this.fail('a glob qualifier or extglob: a word directly followed by "("');
    }
    this.nested(seq, null, () => this.parseSequence(')'));
  }

  nested(seq, subs, parse) {
    const { frames } = this.context;
    if (frames.length >= MAX_NESTING) this.fail('nesting that is too deep');
    frames.push({ pipe: { ...seq.pipe }, subs });
    parse();
    frames.pop();
  }

  finishCommand(seq) {
    const { cmd } = seq;
    seq.cmd = newCommand();
    seq.skipName = false;
    if (cmd.argv.length === 0 && cmd.redirects.length === 0) return;
    this.record(cmd, seq.pipe);
  }

  record(cmd, pipe) {
    const { frames, commands } = this.context;
    cmd.pipes = [{ ...pipe }, ...frames.map((frame) => frame.pipe)];
    commands.push(cmd);
    for (const frame of frames) frame.subs?.push(cmd);
  }

  // `function name` is not a command, but rules need to know the name runs the body that follows.
  recordFunctionName(seq, name) {
    const cmd = { ...newCommand(), argv: [name], braces: [[]], splits: [false], expands: [false] };
    cmd.definesFunction = true;
    this.record(cmd, seq.pipe);
  }

  redirect(seq, operator) {
    this.skipBlanks();
    const { text, quoted } = this.readWord(seq);
    const stripTabs = operator === '<<-';
    if (operator === '<<' || stripTabs) {
      const heredoc = { delimiter: text, stripTabs, expands: !quoted };
      this.pendingHeredocs.push({ ...heredoc, seq: { cmd: seq.cmd, pipe: { ...seq.pipe } } });
    } else {
      (operator === '<<<' ? seq.cmd.heredocs : seq.cmd.redirects).push(text);
    }
  }

  readHeredocBodies() {
    for (const heredoc of this.pendingHeredocs.splice(0)) {
      const body = this.readHeredoc(heredoc);
      heredoc.seq.cmd.heredocs.push(body);
      if (heredoc.expands) new Parser(body, this.context).expandHeredoc(heredoc.seq);
    }
  }

  // An unquoted delimiter means the shell runs $(...) and backticks inside the body.
  expandHeredoc(seq) {
    while (this.pos < this.src.length) {
      const char = this.src[this.pos];
      if (char === '$') this.readDollar(seq, null);
      else if (char === '`') this.readBackticks(seq);
      else this.pos += char === '\\' ? 2 : 1;
    }
  }

  readHeredoc({ delimiter, stripTabs }) {
    const lines = [];
    while (this.pos < this.src.length) {
      const end = this.lineEnd();
      const line = this.src.slice(this.pos, end);
      this.pos = Math.min(end + 1, this.src.length);
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) return lines.join('\n');
      lines.push(line);
    }
    return this.fail('an unterminated here-document');
  }

  addWord(seq) {
    const word = this.readWord(seq);
    const next = this.src[this.pos];
    const fdPrefix = !word.quoted && /^\d+$/.test(word.text) && (next === '<' || next === '>');
    if (fdPrefix) return;
    if (seq.skipName) {
      seq.skipName = false;
      this.recordFunctionName(seq, word.text);
    } else if (!word.quoted && seq.cmd.argv.length === 0 && RESERVED_WORDS.has(word.text)) {
      this.addReservedWord(seq, word.text);
    } else {
      seq.cmd.argv.push(word.text);
      seq.cmd.braces.push(word.braces);
      seq.cmd.splits.push(word.splits);
      seq.cmd.expands.push(word.expands);
      this.lastWordEnd = this.pos;
    }
  }

  addReservedWord(seq, word) {
    const end = COMPOUND_ENDS.get(word);
    if (end) this.nested(seq, null, () => this.parseSequence(end));
    else if (word === seq.terminator) seq.closed = true;
    else seq.skipName = word === 'function';
  }
}

/**
 * Splits shell source into simple commands. Each has `argv` (quotes removed, substitutions kept as source text),
 * `braces` (indexes of unquoted brace syntax per word), `splits` (whether each word holds an unquoted expansion),
 * `expands` (whether each word holds any expansion or substitution, quoted or not), `redirects` (targets),
 * `heredocs` (here-document and here-string bodies), `subs` (commands run by substitutions in its words) and
 * `pipes` (`{pipeline, stage}` for its own pipeline, then for each enclosing group or substitution). A function
 * name (`f() …` or `function f …`) is a command with `definesFunction` set. Throws ShellSyntaxError.
 */
export function tokenize(source) {
  const context = { commands: [], frames: [] };
  new Parser(source, context).parseSequence(null);
  return context.commands;
}
