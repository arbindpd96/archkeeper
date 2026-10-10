import { PathSafetyError } from './errors.js';
import { relativePathProblem, targetPathProblem } from './paths.js';
import { quoted } from './text.js';

const UNC_PREFIX = /^(?:\\\\|\/\/)/;
// Windows opens `.git` by its 8.3 short name too, such as GIT~1.
const GIT_FOLDER = /^(?:\.git|git~\d+)$/i;
const RESERVED_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function deviceName(segment: string): string | undefined {
  // Windows ignores the extension and trailing spaces, so `nul.txt` and `con .md` open the device too.
  const [stem = ''] = segment.split('.');
  return RESERVED_DEVICE.test(stem.trimEnd()) ? segment : undefined;
}

/**
 * Says why the kit may not write or delete `path`, or returns undefined when it may, before any file-system
 * check (#23, ADR-0014). A path is refused when it is absolute, a drive or UNC path, or holds a `..` segment, a
 * backslash, a `:`, a control character such as NUL, a `.git` folder in any case or as `GIT~1`, a Windows device
 * name with or without an extension, a name ending in a dot or a space, or a character outside portable ASCII.
 */
export function pathSafetyProblem(path: string): string | undefined {
  if (UNC_PREFIX.test(path)) return 'starts with a UNC prefix, which names another machine';
  const relative = relativePathProblem(path);
  if (relative !== undefined) return relative;
  const segments = path.split('/');
  if (segments.some((segment) => GIT_FOLDER.test(segment))) {
    return 'lies inside .git, which only git may change';
  }
  const device = segments.map(deviceName).find((name) => name !== undefined);
  if (device !== undefined) return `uses "${device}", a reserved device name on Windows`;
  return targetPathProblem(path);
}

/** Throws PathSafetyError when {@link pathSafetyProblem} refuses `path`; `source` says where the path came from. */
export function assertSafePath(path: string, source: string): void {
  const problem = pathSafetyProblem(path);
  if (problem === undefined) return;
  throw new PathSafetyError({
    file: quoted(path),
    location: source,
    problem: `is refused as a write or delete target: it ${problem}`,
    hint:
      'the kit writes only portable relative paths inside the project and outside .git; ' +
      'if the path came from the lock, restore lock.json from git',
  });
}
