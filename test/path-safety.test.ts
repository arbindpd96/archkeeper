import { describe, expect, it } from 'vitest';
import { PathSafetyError } from '../src/core/errors.js';
import { assertSafePath, pathSafetyProblem } from '../src/core/path-safety.js';

describe('pathSafetyProblem (#23)', () => {
  it.each([
    ['CLAUDE.md'],
    ['.claude/hooks/acmekit/guard.mjs'],
    ['docs/My Notes/a-b_c.md'],
    ['.gitignore'],
    ['.github/workflows/ci.yml'],
    ['console.md'],
    ['com10.txt'],
    ['git/hooks'],
    ['.gitattributes'],
  ])('accepts %s', (path) => {
    expect(pathSafetyProblem(path)).toBeUndefined();
  });

  it.each([
    ['an absolute path', '/etc/passwd', 'is absolute'],
    ['a drive letter', 'C:/Windows/x', 'is absolute'],
    ['a drive-relative path', 'C:x', 'is absolute'],
    ['a UNC path with backslashes', '\\\\server\\share\\x', 'UNC prefix'],
    ['a UNC path with slashes', '//server/share/x', 'UNC prefix'],
    ['a .. segment', 'docs/../../x', '".." segment'],
    ['a backslash', 'docs\\x.md', 'backslash'],
    ['an NTFS stream', 'CLAUDE.md:stream', 'contains a ":"'],
    ['a NUL byte', 'a\u0000b', 'control character'],
    ['a .git folder', '.git/hooks/pre-commit', 'inside .git'],
    ['a .git file', 'sub/.git', 'inside .git'],
    ['.git in upper case', '.GIT/config', 'inside .git'],
    ['.git in mixed case', 'vendor/.Git/HEAD', 'inside .git'],
    ['the 8.3 short name of .git', 'GIT~1/config', 'inside .git'],
    ['a reserved device name', 'CON', 'reserved device name'],
    ['a device name with an extension', 'docs/nul.txt', 'reserved device name'],
    ['a device name in lower case with an extension', 'con.md', 'reserved device name'],
    ['COM1 to COM9', 'com9.log', 'reserved device name'],
    ['LPT1 to LPT9', 'logs/LPT1', 'reserved device name'],
    ['a device name before a space', 'aux .md', 'reserved device name'],
    ['a name ending in a dot', 'docs./x.md', 'ends in a dot or a space'],
    ['a name ending in a space', 'x.md ', 'ends in a dot or a space'],
    ['an empty segment', 'docs//x.md', 'empty or "." segment'],
    ['a non-ASCII name', 'docs/ſettings.json', 'other than ASCII'],
    ['an empty path', '', 'is empty'],
  ])('refuses %s', (_name, path, problem) => {
    expect(pathSafetyProblem(path)).toContain(problem);
  });
});

describe('assertSafePath', () => {
  it('throws PathSafetyError saying what was refused, why and where the path came from', () => {
    const refuse = (): void => {
      assertSafePath('../outside.md', 'listed in the lock');
    };
    expect(refuse).toThrow(PathSafetyError);
    expect(refuse).toThrow(
      '"../outside.md": listed in the lock: is refused as a write or delete target: it has a ".." segment',
    );
    expect(refuse).toThrow('restore lock.json from git');
  });

  it('escapes control characters and bidirectional overrides in the path it echoes', () => {
    const csi = String.fromCharCode(0x9b);
    const override = String.fromCharCode(0x202e);
    const message = ((): string => {
      try {
        assertSafePath(`docs/${csi}31mRED${override}txt.md`, 'listed in the lock');
      } catch (error) {
        return (error as Error).message;
      }
      return 'not refused';
    })();
    expect(message).toMatch(/^"docs\/\\u009b31mRED\\u202etxt\.md": listed in the lock/);
    expect(message.includes(csi) || message.includes(override)).toBe(false);
  });

  it('accepts a safe path', () => {
    expect(() => {
      assertSafePath('docs/notes.md', 'rendered by the kit');
    }).not.toThrow();
  });
});
