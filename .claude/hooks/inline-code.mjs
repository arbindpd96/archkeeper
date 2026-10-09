// Inline code that names one of these can run what it reads, as in `exec(input())` or `require('/dev/stdin')`.
const RUNS_INPUT =
  /\b(?:exec\w*|eval|system|popen\w*|spawn\w*|child_process|Function|compile|__import__|subprocess|runpy|instance_eval|class_eval|module_eval)\b|\/dev\/|\/proc\/|php:\/\//;

const KEY = String.raw`(?:'[\w.-]*'|"[\w.-]*"|\d+)`;
const NAME = String.raw`[A-Za-z_]\w*`;
const LOAD = String.raw`json\.load\(sys\.stdin\)`;
const PY_VALUE = String.raw`(?:${LOAD}|${NAME})(?:\[${KEY}\]|\.get\(${KEY}\))*`;
const PY_STATEMENT = [
  String.raw`import\s+(?:json|sys)(?:\s*,\s*(?:json|sys))*`,
  String.raw`${NAME}\s*=\s*${LOAD}`,
  String.raw`print\(\s*${PY_VALUE}\s*\)`,
  String.raw`print\(\s*json\.dumps\(\s*${PY_VALUE}\s*(?:,\s*indent\s*=\s*\d+)?\s*\)\s*\)`,
].join('|');

const FS = String.raw`require\(\s*(?:'(?:node:)?fs'|"(?:node:)?fs")\s*\)`;
const STDIN_ARG = String.raw`(?:0|'/dev/stdin'|"/dev/stdin")(?:\s*,\s*(?:'utf-?8'|"utf-?8"))?`;
const NODE_READ = String.raw`JSON\.parse\(\s*${FS}\.readFileSync\(\s*${STDIN_ARG}\s*\)\s*\)(?:\.\w+|\[${KEY}\])*`;

// Regex bodies without `$`, `@`, braces, backslashes or backticks cannot interpolate or embed code.
const PERL_REGEX = String.raw`[^/$@{}\\\`]*`;
const RUBY_REGEX = String.raw`[^/$@{}#\\\`]*`;

const whole = (pattern) => new RegExp(String.raw`^\s*(?:${pattern})\s*;?\s*$`);

// Short allowlist of idioms that read piped data and only print it.
const SAFE_CODE = new Map([
  ['python', whole(String.raw`(?:${PY_STATEMENT})(?:\s*[;\n]\s*(?:${PY_STATEMENT}))*`)],
  ['node', whole(String.raw`${NODE_READ}|console\.log\(\s*${NODE_READ}\s*\)`)],
  [
    'perl',
    whole(
      String.raw`s/${PERL_REGEX}/${PERL_REGEX}/[gimsx]*|print(?:\s+(?:if|unless)\s+/${PERL_REGEX}/[imsx]*)?`,
    ),
  ],
  ['ruby', whole(String.raw`(?:puts|print)(?:\s+\$_)?(?:\s+(?:if|unless)\s+/${RUBY_REGEX}/[imx]*)?`)],
]);
const SAFE_MODULES = new Set(['json.tool']);
const STDIN_MODULES = new Set(['code']);

// awk runs commands only through system(), getline from a command, or print into a pipe.
function awkKind(text) {
  if (/\bsystem\b/.test(text)) return 'runs';
  return /\bgetline\b|\|/.test(text) ? 'opaque' : 'safe';
}

/**
 * Classifies inline code as `unknown` (an expansion builds it), `safe` (an allowlisted idiom, or shell code the
 * guard parses itself), `runs` (it can run the data it reads) or `opaque` (anything else).
 */
export function classifyCode(language, text, expands) {
  if (expands) return 'unknown';
  if (language === 'shell') return 'safe';
  if (language === 'awk') return awkKind(text);
  if (SAFE_CODE.get(language)?.test(text)) return 'safe';
  return RUNS_INPUT.test(text) ? 'runs' : 'opaque';
}

/** Classifies a module run with `python -m` the same way as inline code; `code` reads statements from stdin. */
export function classifyModule(name, expands) {
  if (expands) return 'unknown';
  if (SAFE_MODULES.has(name)) return 'safe';
  return STDIN_MODULES.has(name) ? 'runs' : 'opaque';
}
