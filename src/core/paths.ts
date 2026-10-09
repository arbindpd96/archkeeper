const WINDOWS_DRIVE = /^[A-Za-z]:/;

/** True when the text holds a control character, such as a newline or NUL, that no kit path may contain. */
export function hasControlCharacter(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Says why `path` is not a relative path that stays inside its root, or returns undefined when it is one.
 * Kit paths use forward slashes on every OS. #23 adds the checks that need the file system, such as symlinks.
 */
export function relativePathProblem(path: string): string | undefined {
  if (path === '') return 'is empty';
  if (hasControlCharacter(path)) return 'contains a control character';
  if (path.includes('\\')) return 'contains a backslash';
  if (path.startsWith('/') || WINDOWS_DRIVE.test(path)) return 'is absolute';
  if (path.includes(':')) return 'contains a ":"';
  const segments = path.split('/');
  if (segments.includes('..')) return 'has a ".." segment';
  if (segments.some((segment) => segment === '' || segment === '.')) return 'has an empty or "." segment';
  return undefined;
}

/** The form two paths share when they name one file on the default macOS and Windows file systems. */
export function foldedPath(path: string): string {
  // Those file systems ignore case and Unicode normalisation in names.
  return path.normalize('NFC').toLowerCase();
}

/** The fix for a path that {@link relativePathProblem} refuses. */
export const RELATIVE_PATH_HINT =
  'use a relative path with forward slashes, such as docs/notes.md, with no ".." segment, drive or ":"';
