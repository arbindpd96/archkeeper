import { existsSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/core/brand.ts';

/** Folder of the demo tapes, relative to the repository root. */
export const TAPES = 'docs/media/tapes';
/** The shared settings tape that render-tapes puts in front of every tape. */
export const SETTINGS = '_settings.tape';
/** A tape or fixture name: lowercase words joined by dashes, with an optional leading underscore. */
export const TAPE_NAME = /^_?[a-z0-9][a-z0-9-]*$/;

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
// VHS's lexer: comments run to the end of the line, strings and regexes end at a newline, JSON ends at the
// first }, and every other word is an identifier, so a command can start anywhere on a line.
const TAPE_TOKEN =
  /#[^\n]*|"[^"\n]*"?|'[^'\n]*'?|`[^`\n]*`?|\/(?:\\.|[^/\n\\])*\/?|\{[^}]*\}?|([A-Za-z][\w.%/-]*)|[\s\S]/g;
const COMMANDS = new Set(
  [
    'Set Sleep Type Enter Space Backspace Delete Insert Ctrl Alt Shift Down Left Right Up PageUp PageDown',
    'ScrollUp ScrollDown Tab Escape End Hide Require Show Output Wait Source Screenshot Copy Paste Env',
  ]
    .join(' ')
    .split(' '),
);
// A tape is a shell script that the maintainer may record locally with --live, so it may not set the
// environment, hide what it types, write files, read another tape or use the clipboard.
const REFUSED_IN_TAPES = new Set(['Env', 'Hide', 'Output', 'Source', 'Screenshot', 'Copy', 'Paste']);
const SLUGS = [...new Set([BRAND.npmName, BRAND.binName, BRAND.pluginName, BRAND.marketplaceName])];

/** Replaces `{{brand.<key>}}` with the BRAND string, collecting any placeholder that is not one. */
export function fillPlaceholders(text, unknown = []) {
  return text.replace(PLACEHOLDER, (match, key) => {
    const [scope, name, ...rest] = key.split('.');
    const known = scope === 'brand' && rest.length === 0 && Object.hasOwn(BRAND, name);
    if (known && typeof BRAND[name] === 'string') return BRAND[name];
    unknown.push(match);
    return match;
  });
}

/** Lists a tape's identifiers in order, as VHS's lexer reads them. */
function tapeWords(text) {
  return [...text.matchAll(TAPE_TOKEN)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

/** Names the commands a feature tape may not use, wherever they stand on a line. */
function refusedCommands(text) {
  const words = tapeWords(text);
  const refused = words.flatMap((word, index) => {
    if (REFUSED_IN_TAPES.has(word)) return [word];
    const setting = words[index + 1] ?? '';
    return word === 'Set' && setting !== 'TypingSpeed' ? [`Set ${setting}`.trim()] : [];
  });
  return [...new Set(refused)];
}

/** Lists what any tape text must not contain: product-name literals and unknown placeholders. */
function textProblems(label, text) {
  const problems = [];
  const slug = SLUGS.find((candidate) => text.includes(candidate));
  if (slug !== undefined) {
    problems.push(`${label}: write {{brand.binName}} or another {{brand.*}}, not "${slug}".`);
  }
  const unknown = [];
  fillPlaceholders(text, unknown);
  for (const match of unknown) problems.push(`${label}: unknown placeholder ${match}; use {{brand.<key>}}.`);
  return problems;
}

/** Lists why the shared settings tape cannot be used: a command other than Set, a slug or a placeholder. */
export function settingsProblems(text) {
  const label = `${TAPES}/${SETTINGS}`;
  const problems = textProblems(label, text);
  const commands = [...new Set(tapeWords(text).filter((word) => COMMANDS.has(word) && word !== 'Set'))];
  if (commands.length > 0) problems.push(`${label}: holds only Set commands; remove ${commands.join(', ')}.`);
  return problems;
}

/** Lists why a tape cannot be rendered: a refused command, a slug, a placeholder or its fixture. */
export function tapeProblems(root, tape) {
  const label = `${TAPES}/${tape.feature}.tape`;
  const problems = textProblems(label, tape.text);
  const refused = refusedCommands(tape.text);
  if (refused.length > 0) {
    problems.push(
      `${label}: remove ${refused.join(', ')}. Tapes may not use Env, Hide, Output, Source, Screenshot, ` +
        `Copy, Paste or any Set but TypingSpeed; render-tapes adds the output path and ${SETTINGS}.`,
    );
  }
  if (tape.fixture === undefined || !TAPE_NAME.test(tape.fixture)) {
    problems.push(`${label}: name its fixture with a "# fixture: <name>" line (a folder in examples/).`);
  } else if (!existsSync(path.join(root, 'examples', tape.fixture))) {
    problems.push(`${label}: examples/${tape.fixture} does not exist.`);
  }
  return problems;
}
