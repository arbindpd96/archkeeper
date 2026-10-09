const EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
// GNU takes -H -L -P -O<n> and -D <opts> before the paths; BSD also takes -E -X -d -s -x and -f <path>.
const LEADING_FLAG = /^-(?:[HLPEXdsx]+|O\d*)$/;

const endsExec = (arg, segment) => arg === ';' || (arg === '+' && segment.at(-1) === '{}');

function skipLeadingOptions(args, roots) {
  let index = 0;
  for (; index < args.length; index += 1) {
    if (args[index] === '-f') roots.push(args[index + 1] ?? '');
    else if (args[index] !== '-D' && !LEADING_FLAG.test(args[index])) return index;
    if (args[index] === '-f' || args[index] === '-D') index += 1;
  }
  return index;
}

function readRoots(args) {
  const roots = [];
  let index = skipLeadingOptions(args, roots);
  for (; index < args.length && !/^[-(!)]/.test(args[index]); index += 1) roots.push(args[index]);
  return { roots: roots.length > 0 ? roots : ['.'], start: index };
}

function readTokens(args, start) {
  const tokens = [];
  for (let index = start; index < args.length; index += 1) {
    if (!EXEC_ACTIONS.has(args[index])) {
      tokens.push(args[index]);
      continue;
    }
    const exec = [];
    const execStart = index + 1;
    for (index += 1; index < args.length && !endsExec(args[index], exec); index += 1) exec.push(args[index]);
    tokens.push({ exec, start: execStart });
  }
  return tokens;
}

/**
 * Splits `find` arguments into the starting `roots` and the expression `tokens`. Each `-exec`, `-execdir`, `-ok`
 * or `-okdir` segment becomes one `{ exec: argv, start }` token (start is its index in args), so its words are
 * never read as find primaries.
 */
export function readFindExpression(args) {
  const { roots, start } = readRoots(args);
  return { roots, tokens: readTokens(args, start) };
}
