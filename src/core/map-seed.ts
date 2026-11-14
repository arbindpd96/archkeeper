import { parse, TomlError } from 'smol-toml';
import { BRAND, type Brand } from './brand.js';
import { parseJson } from './json.js';
import { findSecret } from './secrets.js';
import { type ProjectView, recordOf, type StackProfile, stackSummary } from './stack-profile.js';
import { type TemplateScope, unsafeValue } from './template.js';
import { compareText, UNPRINTABLE } from './text.js';

/**
 * The folder names the map's Layout leaves out at either level, besides the state folder: dependency, build and cache
 * folders, which `/update-map` tells Claude to leave out too.
 */
export const LEFT_OUT_FOLDERS: ReadonlySet<string> = new Set([
  'node_modules',
  '.yarn',
  'bower_components',
  'jspm_packages',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.turbo',
  '.cache',
]);
const MAX_ROWS = 40;
const MAX_ENTRY_POINTS = 20;
const MAX_CONDITIONS = 4;
// A name, condition or target past 100 characters reads as prose, not an identifier, in the map Claude checks.
const MAX_NAME = 100;
// A backtick ends the code span a name sits in and a bar splits its table row; a comment delimiter would let render's
// import check, which cuts HTML comments first, read two names as one word.
const BREAKS_MARKDOWN = /[`|]|<!--|-->/;
const UNPRINTABLE_CHARACTER = new RegExp(`[${UNPRINTABLE}]`, 'u');
const NO_LAYOUT = 'Run `/update-map` to list the project folders here.';
const NO_ENTRY_POINTS = 'None found in `package.json` or `pyproject.toml`.';
const PACKAGE_JSON = '`package.json`';
const PYPROJECT = '`pyproject.toml`';

/** One entry point: what declares it, its name, any export conditions, and the file or function it runs. */
interface EntryPoint {
  readonly source: string;
  readonly name: string;
  readonly conditions: readonly string[];
  readonly target: string;
}

function stackLine(profile: StackProfile): string {
  const summary = stackSummary(profile);
  if (summary === '') return 'not detected';
  const frameworks = profile.frameworks.length === 0 ? '' : `; frameworks: ${profile.frameworks.join(', ')}`;
  return `${summary}${frameworks}`;
}

// The names a line quotes, each short and plain, then the line as render checks it: no control character, block
// marker or refused @ import in a value, and no likely secret in the file.
function writable(names: readonly string[], line: string, brand: Brand): boolean {
  const plain = names.every(
    (name) => name.length <= MAX_NAME && !BREAKS_MARKDOWN.test(name) && !UNPRINTABLE_CHARACTER.test(name),
  );
  return plain && unsafeValue({ line }, brand) === undefined && findSecret(line) === undefined;
}

function folderAt(file: string, depth: number): string | undefined {
  let end = -1;
  for (let level = 0; level < depth; level += 1) {
    end = file.indexOf('/', end + 1);
    if (end === -1) return undefined;
  }
  return file.slice(0, end + 1);
}

function rowOf(folder: string): string {
  return `| \`${folder}\` | |`;
}

function listed(folder: string, brand: Brand): boolean {
  const names = folder.slice(0, -1).split('/');
  const leftOut = names.some((name) => LEFT_OUT_FOLDERS.has(name) || name === brand.stateDir);
  return !leftOut && writable([folder], rowOf(folder), brand);
}

function foldersAt(tracked: readonly string[], depth: number, keep: (folder: string) => boolean): string[] {
  const folders = new Set<string>();
  for (const file of tracked) {
    const folder = folderAt(file, depth);
    if (folder !== undefined) folders.add(folder);
  }
  return [...folders].filter(keep).sort(compareText);
}

// Folders of depth 1, then depth 2 under a listed one, so the cap drops nested folders before top-level ones.
function layoutLines(tracked: readonly string[] | undefined, brand: Brand): string[] {
  if (tracked === undefined) return [NO_LAYOUT];
  const top = foldersAt(tracked, 1, (folder) => listed(folder, brand));
  const parents = new Set(top);
  const nested = foldersAt(
    tracked,
    2,
    (folder) => parents.has(folderAt(folder, 1) ?? '') && listed(folder, brand),
  );
  const folders = [...top, ...nested];
  if (folders.length === 0) return [NO_LAYOUT];
  const shown = folders.length > MAX_ROWS ? folders.slice(0, MAX_ROWS - 1) : folders;
  const more = folders.length - shown.length;
  const rest = more === 0 ? [] : [`| … and ${String(more)} more folders | |`];
  return ['| Path | Purpose |', '| --- | --- |', ...shown.map(rowOf), ...rest];
}

function namedStrings(value: unknown): [name: string, text: string][] {
  return Object.entries(recordOf(value) ?? {}).flatMap(([name, text]) =>
    name !== '' && typeof text === 'string' && text !== '' ? [[name, text]] : [],
  );
}

function entry(source: string, name: string, target: string, conditions: readonly string[] = []): EntryPoint {
  return { source, name, conditions, target };
}

// A string bin is the package's own command, named after the package without its scope.
function binEntries(manifest: Readonly<Record<string, unknown>>): EntryPoint[] {
  const source = `${PACKAGE_JSON} bin`;
  const { bin, name } = manifest;
  if (typeof bin !== 'string') {
    return namedStrings(bin).map(([command, target]) => entry(source, command, target));
  }
  const command = typeof name === 'string' ? name.replace(/^@[^/]*\//, '') : '';
  return bin === '' ? [] : [entry(source, command, bin)];
}

// Conditions nest, as in `{"node": {"import": "./a.mjs"}}`; a few levels cover real packages.
function exportTargets(value: unknown, conditions: readonly string[]): [string[], string][] {
  if (typeof value === 'string') return value === '' ? [] : [[[...conditions], value]];
  if (conditions.length === MAX_CONDITIONS) return [];
  return Object.entries(recordOf(value) ?? {}).flatMap(([condition, inner]) =>
    condition === '' ? [] : exportTargets(inner, [...conditions, condition]),
  );
}

// An exports object maps subpaths, which start with a dot, or else conditions of the package's main subpath.
function exportEntries(exports: unknown): EntryPoint[] {
  const source = `${PACKAGE_JSON} exports`;
  const record = recordOf(exports);
  const bySubpath =
    record !== undefined && Object.keys(record).every((key) => key.startsWith('.'))
      ? Object.entries(record)
      : [['.', exports] as const];
  return bySubpath.flatMap(([subpath, value]) =>
    exportTargets(value, []).map(([conditions, target]) => entry(source, subpath, target, conditions)),
  );
}

function packageEntryPoints(view: ProjectView): EntryPoint[] {
  const text = view.read('package.json');
  const parsed = text === undefined ? undefined : parseJson(text);
  const manifest = parsed?.ok === true ? recordOf(parsed.value) : undefined;
  if (manifest === undefined) return [];
  const main = typeof manifest.main === 'string' && manifest.main !== '' ? [manifest.main] : [];
  return [
    ...binEntries(manifest),
    ...main.map((target) => entry(`${PACKAGE_JSON} main`, '', target)),
    ...exportEntries(manifest.exports),
  ];
}

function scriptEntryPoints(view: ProjectView): EntryPoint[] {
  const text = view.read('pyproject.toml');
  if (text === undefined) return [];
  try {
    const scripts = recordOf(recordOf(parse(text).project)?.scripts);
    return namedStrings(scripts).map(([name, target]) => entry(`${PYPROJECT} script`, name, target));
  } catch (error) {
    if (error instanceof TomlError) return [];
    throw error;
  }
}

// Every value from the project sits in a code span, export conditions too, since they are arbitrary keys.
function entryLine({ source, name, conditions, target }: EntryPoint): string {
  const named = name === '' ? '' : ` \`${name}\``;
  const when =
    conditions.length === 0 ? '' : ` (${conditions.map((condition) => `\`${condition}\``).join(', ')})`;
  return `- ${source}${named}${when}: \`${target}\``;
}

function entryPointLines(view: ProjectView, brand: Brand): string[] {
  const lines = [...packageEntryPoints(view), ...scriptEntryPoints(view)].flatMap((point) => {
    const line = entryLine(point);
    return writable([point.name, point.target, ...point.conditions], line, brand) ? [line] : [];
  });
  if (lines.length === 0) return [NO_ENTRY_POINTS];
  if (lines.length <= MAX_ENTRY_POINTS) return lines;
  const more = lines.length - MAX_ENTRY_POINTS + 1;
  return [...lines.slice(0, MAX_ENTRY_POINTS - 1), `- … and ${String(more)} more`];
}

/**
 * The template values that seed `docs/architecture.md` (#36), the same bytes for the same project: `map.stack`,
 * one line of the detected languages, package managers and frameworks; `map.layout`, a table of the folders in
 * `tracked`, the files git tracks, or a line asking for `/update-map` when git gave no list; and `map.entryPoints`,
 * from package.json and pyproject.toml, none from a malformed one, each value in a code span. A name over 100
 * characters, one that could break the Markdown, or one that render refuses, is left out, so no file name can make
 * render throw.
 */
export function mapValues(
  profile: StackProfile,
  view: ProjectView,
  tracked: readonly string[] | undefined,
  brand: Brand = BRAND,
): TemplateScope {
  return {
    map: {
      stack: stackLine(profile),
      layout: layoutLines(tracked, brand),
      entryPoints: entryPointLines(view, brand),
    },
  };
}
