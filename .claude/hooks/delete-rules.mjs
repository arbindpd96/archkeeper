import { hasLong, parseOptions } from './cli-options.mjs';
import { unwrap } from './command-wrappers.mjs';
import { isDangerousPath, isUncheckedPath } from './dangerous-paths.mjs';
import { readFindExpression } from './find-expression.mjs';
import { ask, deny, strictest } from './verdicts.mjs';

const DANGEROUS_DELETE = deny('Recursive delete of a root, home or whole-directory path is blocked.');
const UNSEEN_DELETE = ask(
  'Recursive delete of paths from a variable, command output, xargs or find cannot be checked. Confirm with the user.',
);

// -regex and -iregex are left out on purpose: a regex such as `.*` matches everything, so it never narrows.
const NAME_FILTERS = new Set(['-name', '-iname', '-lname', '-ilname']);
const PATH_FILTERS = new Set(['-path', '-ipath', '-wholename', '-iwholename']);
const LOGIC = new Set(['-o', '-or', '!', '-not', ',']);
const DELETING_PROGRAMS = new Set(['rm', 'unlink']);

const isRecursive = (options) =>
  options.short.has('r') || options.short.has('R') || hasLong(options, '--recursive', 3);

/** Judges `rm`: a dangerous target is denied; targets chosen at run time ask. */
export function rmRule({ args, wrappers, splitArgs }) {
  const options = parseOptions(args);
  const recursive = isRecursive(options);
  const targets = [...options.operands, ...options.afterDashes];
  // An unquoted expansion such as `rm $FLAGS /` may supply -r at run time, so a dangerous target is enough.
  if ((recursive || splitArgs) && targets.some(isDangerousPath)) return DANGEROUS_DELETE;
  // find -exec and xargs supply the targets at run time, so even a plain `rm` there deletes unseen paths.
  const runner = wrappers.includes('xargs') || wrappers.includes('find');
  const unseen = runner || targets.some(isUncheckedPath);
  return (recursive || splitArgs || runner) && unseen ? UNSEEN_DELETE : null;
}

const isDeleteAction = (token) =>
  token === '-delete' || (typeof token === 'object' && DELETING_PROGRAMS.has(unwrap(token.exec).program));

// A pattern narrows only with literal text other than dots; `-path` matches whole paths, so its last segment counts.
function patternFilter(filter, pattern) {
  if (typeof pattern !== 'string') return 'none';
  if (/[$`]/.test(pattern)) return 'unknown';
  const tail = PATH_FILTERS.has(filter) ? pattern.slice(pattern.lastIndexOf('/') + 1) : pattern;
  return /[^.]/.test(tail.replace(/\[[^\]]*\]|[*?]/g, '')) ? 'narrowed' : 'none';
}

const FILTER_STRENGTH = ['none', 'unknown', 'narrowed'];
const stronger = (a, b) => (FILTER_STRENGTH.indexOf(a) >= FILTER_STRENGTH.indexOf(b) ? a : b);

// Only top-level filters before the delete action count: find evaluates left to right and -delete acts at once.
function filterBefore(tokens, end) {
  let depth = 0;
  let found = 'none';
  for (let index = 0; index < end; index += 1) {
    const token = tokens[index];
    if (token === '(') depth += 1;
    else if (token === ')') depth -= 1;
    else if (depth === 0 && (NAME_FILTERS.has(token) || PATH_FILTERS.has(token))) {
      found = stronger(found, patternFilter(token, tokens[index + 1]));
    }
  }
  return found;
}

function deleteVerdict(tokens, end) {
  if (tokens.some((token) => LOGIC.has(token))) return DANGEROUS_DELETE;
  const filter = filterBefore(tokens, end);
  if (filter === 'none') return DANGEROUS_DELETE;
  return filter === 'unknown' ? UNSEEN_DELETE : null;
}

function judgeFind({ args, splitArgs }, deletesOutput) {
  const { roots, tokens } = readFindExpression(args);
  const actionAt = tokens.findIndex(isDeleteAction);
  const deletes = actionAt !== -1 || deletesOutput;
  if (!roots.some(isDangerousPath)) return deletes && roots.some(isUncheckedPath) ? UNSEEN_DELETE : null;
  const verdict = deletes ? deleteVerdict(tokens, actionAt === -1 ? tokens.length : actionAt) : null;
  // An unquoted expansion such as `find ~ $OP` may add -delete or -o at run time.
  return verdict ?? (splitArgs ? UNSEEN_DELETE : null);
}

/** Judges `find`: deleting under a root, home or project path needs a filter that narrows before the delete. */
export function findRule(command) {
  return judgeFind(command, false);
}

const isXargsRm = (command) => DELETING_PROGRAMS.has(command.program) && command.wrappers.includes('xargs');

/** Judges `find ... | xargs rm` as if the find deleted every path it prints. */
export function findPipedToRm(commands) {
  const removerStages = commands.filter(isXargsRm).flatMap((command) => command.pipes);
  const feedsRemover = ({ pipes: [own] }) =>
    removerStages.some(({ pipeline, stage }) => pipeline === own.pipeline && stage > own.stage);
  const finds = commands.filter((command) => command.program === 'find' && feedsRemover(command));
  return strictest(finds.map((find) => judgeFind(find, true)));
}
