import { describe, expect, it } from 'vitest';
import { decodeEscapes } from '../src/hooks/runtime/shell/ansi-c-quote.js';
import { expandBraces } from '../src/hooks/runtime/shell/braces.js';
import { parseCommands } from '../src/hooks/runtime/shell/commands.js';
import { ShellSyntaxError } from '../src/hooks/runtime/shell/syntax.js';

const programs = (source: string): string[][] =>
  parseCommands(source).map((command) => [command.program, ...command.args]);

describe('the shell parser guard-bash judges with', () => {
  it('splits chains and pipelines into simple commands', () => {
    expect(programs('ls -la && git status; echo "a b" | wc -l')).toEqual([
      ['ls', '-la'],
      ['git', 'status'],
      ['echo', 'a b'],
      ['wc', '-l'],
    ]);
  });

  it('unwraps runners and parses the code they run', () => {
    const [outer, inner] = parseCommands('sudo env X=1 bash -c "rm -rf ~"');
    expect(outer).toMatchObject({ program: 'bash', wrappers: ['sudo', 'env'], assignments: ['X=1'] });
    expect(inner).toMatchObject({ program: 'rm', args: ['-rf', '~'], wrappers: ['sudo', 'env'] });
  });

  it('parses the commands substitutions run, as subs of their command', () => {
    const echo = parseCommands('echo "$(id -u)" `whoami`').find((command) => command.program === 'echo');
    expect(echo?.subs.map((sub) => sub.program)).toEqual(['id', 'whoami']);
  });

  it('puts each command of a pipeline at its stage', () => {
    const stages = parseCommands('a | b | c').map((command) => command.pipes[0]?.stage);
    expect(stages).toEqual([0, 1, 2]);
  });

  it('reads arithmetic and array assignments as words (#31)', () => {
    expect(programs('echo $((1 << 2)); arr=(rm -rf ~)')).toEqual([['echo', '$((1 << 2))'], ['']]);
  });

  it.each(['echo "unterminated', "echo 'x", 'cat <<EOF\nx', 'echo $(( 1 + 2', 'ls *(e:x:)'])(
    'refuses %j, which every shell may not read alike',
    (source) => {
      expect(() => parseCommands(source)).toThrow(ShellSyntaxError);
    },
  );

  it('expands unquoted braces and sequences', () => {
    expect(expandBraces('a{b,c}d{1..3}', [1, 3, 5, 7, 12])).toEqual([
      'abd1',
      'abd2',
      'abd3',
      'acd1',
      'acd2',
      'acd3',
    ]);
  });

  it('decodes the escapes printf and echo -e print', () => {
    expect(decodeEscapes('\\162m \\x2drf \\u007e')).toBe('rm -rf ~');
  });
});
