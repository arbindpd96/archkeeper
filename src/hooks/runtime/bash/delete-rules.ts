import type { Command } from '../shell/commands.js';
import { readFindExpression, type FindToken } from '../shell/find-expression.js';
import { hasExpansion } from '../shell/syntax.js';
import { unwrap } from '../shell/wrappers.js';
import { hasLong, parseOptions, type ParsedOptions } from './cli-options.js';
import { isDangerousPath, isUncheckedPath, type PathContext } from './dangerous-paths.js';
import type { JudgeContext } from './judge-context.js';
import { ask, deny, strictest, type Verdict } from './verdicts.js';

const DANGEROUS_DELETE = deny('Recursive delete of a root, home or whole-directory path is blocked.');
const UNSEEN_DELETE = ask(
  'Recursive delete of paths from a variable, command output, xargs or find cannot be checked. Confirm with the user.',
);

// -regex and -iregex are left out on purpose: a regex such as `.*` matches everything, so it never narrows.
const NAME_FILTERS: ReadonlySet<string> = new Set(['-name', '-iname', '-lname', '-ilname']);
const PATH_FILTERS: ReadonlySet<string> = new Set(['-path', '-ipath', '-wholename', '-iwholename']);
const LOGIC: ReadonlySet<string> = new Set(['-o', '-or', '!', '-not', ',']);
const DELETING_PROGRAMS: ReadonlySet<string> = new Set(['rm', 'unlink']);
const FILTER_STRENGTH = ['none', 'unknown', 'narrowed'] as const;

type Filter = (typeof FILTER_STRENGTH)[number];

const isRecursive = (options: ParsedOptions): boolean =>
  options.short.has('r') || options.short.has('R') || hasLong(options, '--recursive', 3);

/** Judges `rm`: a dangerous target is denied; targets chosen at run time ask. */
export function rmRule({ args, wrappers, splitArgs }: Command, { paths }: JudgeContext): Verdict | null {
  const options = parseOptions(args);
  const recursive = isRecursive(options);
  const targets = [...options.operands, ...options.afterDashes];
  // An unquoted expansion such as `rm $FLAGS /` may supply -r at run time, so a dangerous target is enough.
  if ((recursive || splitArgs) && targets.some((target) => isDangerousPath(target, paths))) {
    return DANGEROUS_DELETE;
  }
  // find -exec and xargs supply the targets at run time, so even a plain `rm` there deletes unseen paths.
  const runner = wrappers.includes('xargs') || wrappers.includes('find');
  const unseen = runner || targets.some(isUncheckedPath);
  return (recursive || splitArgs || runner) && unseen ? UNSEEN_DELETE : null;
}

const isDeleteAction = (token: FindToken): boolean =>
  token === '-delete' || (typeof token === 'object' && DELETING_PROGRAMS.has(unwrap(token.exec).program));

// A pattern narrows only with literal text other than dots; `-path` matches whole paths, so its last segment counts.
function patternFilter(filter: string, pattern: FindToken | undefined): Filter {
  if (typeof pattern !== 'string') return 'none';
  if (hasExpansion(pattern)) return 'unknown';
  const tail = PATH_FILTERS.has(filter) ? pattern.slice(pattern.lastIndexOf('/') + 1) : pattern;
  return /[^.]/.test(tail.replace(/\[[^\]]*\]|[*?]/g, '')) ? 'narrowed' : 'none';
}

const stronger = (a: Filter, b: Filter): Filter =>
  FILTER_STRENGTH.indexOf(a) >= FILTER_STRENGTH.indexOf(b) ? a : b;

// Only top-level filters before the delete action count: find evaluates left to right and -delete acts at once.
function filterBefore(tokens: readonly FindToken[], end: number): Filter {
  let depth = 0;
  let found: Filter = 'none';
  for (const [index, token] of tokens.slice(0, end).entries()) {
    if (token === '(') depth += 1;
    else if (token === ')') depth -= 1;
    else if (
      depth === 0 &&
      typeof token === 'string' &&
      (NAME_FILTERS.has(token) || PATH_FILTERS.has(token))
    ) {
      found = stronger(found, patternFilter(token, tokens[index + 1]));
    }
  }
  return found;
}

function deleteVerdict(tokens: readonly FindToken[], end: number): Verdict | null {
  if (tokens.some((token) => typeof token === 'string' && LOGIC.has(token))) return DANGEROUS_DELETE;
  const filter = filterBefore(tokens, end);
  if (filter === 'none') return DANGEROUS_DELETE;
  return filter === 'unknown' ? UNSEEN_DELETE : null;
}

function judgeFind({ args, splitArgs }: Command, paths: PathContext, deletesOutput: boolean): Verdict | null {
  const { roots, tokens } = readFindExpression(args);
  const actionAt = tokens.findIndex(isDeleteAction);
  const deletes = actionAt !== -1 || deletesOutput;
  // An unquoted expansion such as `find ~ $OP` may add -delete or -o at run time.
  const mayDelete = deletes || splitArgs;
  if (!roots.some((root) => isDangerousPath(root, paths))) {
    return mayDelete && roots.some(isUncheckedPath) ? UNSEEN_DELETE : null;
  }
  const verdict = deletes ? deleteVerdict(tokens, actionAt === -1 ? tokens.length : actionAt) : null;
  return verdict ?? (splitArgs ? UNSEEN_DELETE : null);
}

/** Judges `find`: deleting under a root, home or project path needs a filter that narrows before the delete. */
export function findRule(command: Command, { paths }: JudgeContext): Verdict | null {
  return judgeFind(command, paths, false);
}

const isXargsRm = (command: Command): boolean =>
  DELETING_PROGRAMS.has(command.program) && command.wrappers.includes('xargs');

/** Judges `find ... | xargs rm` as if the find deleted every path it prints. */
export function findPipedToRm(commands: readonly Command[], { paths }: JudgeContext): Verdict | null {
  const removerStages = commands.filter(isXargsRm).flatMap((command) => command.pipes);
  const feedsRemover = ({ pipes: [own] }: Command): boolean =>
    own !== undefined &&
    removerStages.some(({ pipeline, stage }) => pipeline === own.pipeline && stage > own.stage);
  const finds = commands.filter((command) => command.program === 'find' && feedsRemover(command));
  return strictest(finds.map((find) => judgeFind(find, paths, true)));
}
