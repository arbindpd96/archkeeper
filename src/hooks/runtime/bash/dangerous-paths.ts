import { hasExpansion } from '../shell/syntax.js';
import { globMatches } from './glob-match.js';

const HOME_ANCHORS: ReadonlySet<string> = new Set([
  '~',
  '$HOME',
  '$PWD',
  '$CLAUDE_PROJECT_DIR',
  '$(pwd)',
  '`pwd`',
]);
const HOME_PARENTS: readonly string[] = ['home', 'users'];
const SYSTEM_DIRS: ReadonlySet<string> = new Set([
  ...['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib32', 'lib64', 'media', 'mnt', 'nix', 'opt', 'proc'],
  ...['root', 'run', 'sbin', 'snap', 'srv', 'sys', 'tmp', 'usr', 'var'],
  ...['applications', 'cores', 'library', 'private', 'system', 'users', 'volumes'],
  ...['windows', 'program files', 'program files (x86)', 'programdata'],
]);
const GLOB = /[*?[]/;
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME(?::?[-=?+][^}]*)?\})(?=\/|$)/;
const PROJECT_PREFIX = /^\$(?:CLAUDE_PROJECT_DIR|\{CLAUDE_PROJECT_DIR\})(?=\/|$)/;
const WORKING_FOLDER_PREFIX = /^(?:\$PWD|\$\{PWD\}|\$\(pwd\)|`pwd`)(?=\/|$)/;
const ANCHORED_PREFIX = /^(?:~|\$\{?(?:HOME|PWD|CLAUDE_PROJECT_DIR)\}?)\//;
const DRIVE = /^([A-Za-z]):(?=\/|$)/;
const CYGDRIVE = /^\/cygdrive\/([A-Za-z])(?=\/|$)/;

/**
 * The folders a recursive delete must never remove or hold (the user's home and the project, as segments, in every
 * spelling the hook knows), and the folders a relative path may start from: null once a `cd` to a folder decided at
 * run time leaves that unknown.
 */
export interface PathContext {
  readonly home: string;
  readonly project: string;
  readonly protectedDirs: readonly (readonly string[])[];
  readonly cwds: readonly string[] | null;
}

const isHomeAnchor = (segment: string): boolean => HOME_ANCHORS.has(segment) || /^~[\w.+-]*$/.test(segment);
const isWildcard = (segment: string): boolean => segment.includes('*') && /^[*?.]+$/.test(segment);
const isUpward = (segments: readonly string[]): boolean => segments.every((segment) => segment === '..');
const segmentMatches = (pattern: string, actual: string): boolean =>
  pattern === actual || (GLOB.test(pattern) && globMatches(pattern, actual));

/**
 * One spelling of a path for every OS: forward slashes, and a Windows drive (`C:\`, Git Bash's `/c/`, Cygwin's
 * `/cygdrive/c/`) as `/c/`, so a home or project folder on a drive is protected however it is written (#31).
 */
export function portablePath(file: string): string {
  const slashed = file.replaceAll('\\', '/');
  const drive = (_: string, letter: string): string => `/${letter.toLowerCase()}`;
  return slashed.replace(DRIVE, drive).replace(CYGDRIVE, drive);
}

function climb(segments: string[], absolute: boolean): void {
  const last = segments.at(-1);
  if (last !== undefined && last !== '..' && !isHomeAnchor(last)) segments.pop();
  else if (!absolute || last !== undefined) segments.push('..');
}

/** Resolves `.`, `..` and empty segments of a path, keeping a leading `..` that climbs above where it starts. */
export function resolveSegments(file: string): string[] {
  const absolute = file.startsWith('/');
  const segments: string[] = [];
  for (const part of file.split('/')) {
    const segment = part.replace(/^\$\{(\w+)(?::?[-=?+][^}]*)?\}$/, '$$$1');
    if (segment === '..') climb(segments, absolute);
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  while (segments.length > 0 && isWildcard(segments.at(-1) ?? '')) segments.pop();
  return segments;
}

/** The context for judging paths: home and the project, and every folder above them, are protected. */
export function pathContext(
  home: string,
  projectDir: string,
  cwd: string = projectDir,
  realDirs: readonly string[] = [],
): PathContext {
  const portableHome = portablePath(home);
  const project = portablePath(projectDir);
  // The real paths of home and the project are protected too: `/tmp` is `/private/tmp` on macOS.
  const protectedDirs = [portableHome, project, ...realDirs.map(portablePath)]
    .filter((dir) => dir.startsWith('/'))
    .map((dir) => resolveSegments(dir).map((segment) => segment.toLowerCase()));
  const start = [portablePath(cwd), project].find((dir) => dir.startsWith('/'));
  return { home: portableHome, project, protectedDirs, cwds: start === undefined ? null : [start] };
}

function isRootLevel(lower: readonly string[]): boolean {
  const [top = ''] = lower;
  const topLevel = lower.length === 1 && (SYSTEM_DIRS.has(top) || GLOB.test(top));
  const homeLevel = lower.length === 2 && HOME_PARENTS.some((parent) => segmentMatches(top, parent));
  return lower.length === 0 || topLevel || homeLevel;
}

const holdsProtected = (lower: readonly string[], context: PathContext): boolean =>
  context.protectedDirs.some(
    (dir) =>
      lower.length <= dir.length &&
      lower.every((segment, index) => segmentMatches(segment, dir[index] ?? '')),
  );

// A path on a drive (`/c/Users/me`) is also judged as if the drive were the root.
function isProtectedAbsolute(segments: readonly string[], context: PathContext): boolean {
  const lower = segments.map((segment) => segment.toLowerCase());
  const onDrive = /^[a-z]$/.test(lower[0] ?? '') ? [lower.slice(1)] : [];
  return holdsProtected(lower, context) || [lower, ...onDrive].some(isRootLevel);
}

/** Tells whether a path is decided at run time by a variable or command, beyond a known home or project prefix. */
export function isUncheckedPath(word: string): boolean {
  return hasExpansion(word.replace(ANCHORED_PREFIX, ''));
}

// Home and project prefixes written out, and `$PWD` as `.`: `~/Documents` holds the project when it lives there,
// which only the absolute form reveals.
function anchored(word: string, context: PathContext): string {
  const portable = portablePath(word);
  const file = context.home.startsWith('/') ? portable.replace(HOME_PREFIX, context.home) : portable;
  const inProject = context.project.startsWith('/') ? file.replace(PROJECT_PREFIX, context.project) : file;
  return inProject.replace(WORKING_FOLDER_PREFIX, '.');
}

const isRelative = (file: string): boolean => !file.startsWith('/') && !file.startsWith('~');

/** Tells whether a delete target is decided at run time: by an expansion, or as a relative path after an unknown `cd`. */
export function isUncheckedTarget(word: string, context: PathContext): boolean {
  return isUncheckedPath(word) || (context.cwds === null && isRelative(anchored(word, context)));
}

/** The folder `cd <target>` moves to from `base`, or null when an expansion, a glob or `~user` decides it. */
export function resolveFolder(target: string, base: string, context: PathContext): string | null {
  const file = anchored(target, context);
  if (hasExpansion(file) || GLOB.test(file) || file.startsWith('~')) return null;
  return `/${resolveSegments(file.startsWith('/') ? file : `${base}/${file}`).join('/')}`;
}

/** Each absolute path, as lower-cased segments, a literal `word` names from the folders its command may run in. */
export function absoluteTargets(word: string, context: PathContext): string[][] {
  const file = anchored(word, context);
  if (hasExpansion(file) || file.startsWith('~')) return [];
  const forms = file.startsWith('/') ? [file] : (context.cwds ?? []).map((cwd) => `${cwd}/${file}`);
  return forms.map((form) => resolveSegments(form).map((segment) => segment.toLowerCase()));
}

/** Tells whether deleting `word` recursively would remove a root, system, home or project folder or a parent of one. */
export function isDangerousPath(word: string, context: PathContext): boolean {
  if (word === '') return false;
  const file = anchored(word, context);
  const segments = resolveSegments(file);
  if (file.startsWith('/')) return isProtectedAbsolute(segments, context);
  const [first = '', ...rest] = segments;
  // `.` or `..` alone always counts, and any other relative path is judged from each folder it may start from.
  const upward = isUpward(segments) || (isHomeAnchor(first) && isUpward(rest));
  return upward || absoluteTargets(word, context).some((target) => isProtectedAbsolute(target, context));
}

/** Tells whether a literal path names the home or project folder, under any known spelling, or a folder above one. */
export function holdsProtectedDir(word: string, context: PathContext): boolean {
  return absoluteTargets(word, context).some((target) => holdsProtected(target, context));
}
