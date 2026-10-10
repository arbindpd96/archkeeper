const EXEC_ACTIONS: ReadonlySet<string> = new Set(['-exec', '-execdir', '-ok', '-okdir']);
// GNU takes -H -L -P -O<n> and -D <opts> before the paths; BSD also takes -E -X -d -s -x and -f <path>.
const LEADING_FLAG = /^-(?:[HLPEXdsx]+|O\d*)$/;

/** One `-exec`, `-execdir`, `-ok` or `-okdir` segment: the command it runs and its index in find's arguments. */
export interface ExecToken {
  readonly exec: string[];
  readonly start: number;
}

/** A find expression token: a primary, operator or operand word, or a whole exec segment. */
export type FindToken = string | ExecToken;

/** The starting points of a find command and its expression. */
export interface FindExpression {
  readonly roots: string[];
  readonly tokens: FindToken[];
}

const endsExec = (arg: string, segment: readonly string[]): boolean =>
  arg === ';' || (arg === '+' && segment.at(-1) === '{}');

function skipLeadingOptions(args: readonly string[], roots: string[]): number {
  let index = 0;
  for (; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-f') roots.push(args[index + 1] ?? '');
    else if (arg !== '-D' && !LEADING_FLAG.test(arg)) return index;
    if (arg === '-f' || arg === '-D') index += 1;
  }
  return index;
}

function readRoots(args: readonly string[]): { roots: string[]; start: number } {
  const roots: string[] = [];
  let index = skipLeadingOptions(args, roots);
  for (; index < args.length && !/^[-(!)]/.test(args[index] ?? ''); index += 1) roots.push(args[index] ?? '');
  return { roots: roots.length > 0 ? roots : ['.'], start: index };
}

function readTokens(args: readonly string[], start: number): FindToken[] {
  const tokens: FindToken[] = [];
  for (let index = start; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!EXEC_ACTIONS.has(arg)) {
      tokens.push(arg);
      continue;
    }
    const exec = readExec(args, index + 1);
    tokens.push(exec);
    index = exec.start + exec.exec.length;
  }
  return tokens;
}

function readExec(args: readonly string[], start: number): ExecToken {
  const exec: string[] = [];
  for (let index = start; index < args.length && !endsExec(args[index] ?? '', exec); index += 1) {
    exec.push(args[index] ?? '');
  }
  return { exec, start };
}

/**
 * Splits `find` arguments into the starting `roots` and the expression `tokens`, with each exec segment as one
 * token, so its words are never read as find primaries.
 */
export function readFindExpression(args: readonly string[]): FindExpression {
  const { roots, start } = readRoots(args);
  return { roots, tokens: readTokens(args, start) };
}
