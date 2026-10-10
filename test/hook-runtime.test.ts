import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import {
  type Answer,
  block,
  context,
  type HookInput,
  noAnswer,
  parseInput,
  permission,
  refuse,
  respond,
} from '../src/hooks/runtime/io.js';
import {
  FAILURE_POLICY,
  type HookModule,
  launch,
  type LaunchIo,
  outcomeOf,
} from '../src/hooks/runtime/launch.js';
import { projectDirOf, slashed } from '../src/hooks/runtime/project.js';

interface Captured {
  readonly io: LaunchIo;
  readonly out: { stdout: string; stderr: string };
}

function capture(argv: readonly string[] = [], input: HookInput = { payload: {} }): Captured {
  const out = { stdout: '', stderr: '' };
  const io: LaunchIo = {
    argv,
    input: () => input,
    context: () => ({ projectDir: '/p', home: '/home/u' }),
    streams: {
      stdout: (text) => {
        out.stdout += text;
      },
      stderr: (text) => {
        out.stderr += text;
      },
    },
  };
  return { io, out };
}

const asking: HookModule = {
  answer: (input) => (input.problem === undefined ? noAnswer() : permission('ask', 'unreadable')),
  samples: [
    { name: 'an empty payload', payload: {}, expect: 'allow' },
    { name: 'a payload', payload: { tool_input: {} }, expect: 'allow' },
  ],
};

describe('hook input (ADR-0015)', () => {
  it.each([
    ['', 'stdin was empty'],
    ['{', 'stdin was not valid JSON'],
    ['[1]', 'stdin was not a JSON object'],
    ['null', 'stdin was not a JSON object'],
  ])('reads %j as {} and names the problem', (text, problem) => {
    expect(parseInput(text)).toEqual({ payload: {}, problem });
  });

  it('reads a JSON object as the payload', () => {
    expect(parseInput('{"tool_input":{"command":"ls"}}')).toEqual({
      payload: { tool_input: { command: 'ls' } },
    });
  });
});

describe('hook answers (ADR-0015, reference §1.5)', () => {
  function written(answer: Answer): { code: number; stdout: string; stderr: string } {
    const { io, out } = capture();
    const code = respond(answer, io.streams);
    return { code, ...out };
  }

  it('prints a permission decision as JSON with exit 0, its reason naming the guard', () => {
    const { code, stdout, stderr } = written(permission('deny', 'no.'));
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${BRAND.displayName} guard: no.`,
      },
    });
  });

  it('refuses with exit 2 and stderr alone, never with JSON', () => {
    expect(written(refuse('Stop.'))).toEqual({ code: 2, stdout: '', stderr: 'Stop.\n' });
  });

  it('prints a decision to block as JSON with exit 0', () => {
    expect(JSON.parse(written(block('Update the memory.')).stdout)).toEqual({
      decision: 'block',
      reason: 'Update the memory.',
    });
  });

  it('writes a note to stderr and nothing to stdout when it has nothing to say', () => {
    expect(written(noAnswer('a note'))).toEqual({ code: 0, stdout: '', stderr: 'a note\n' });
  });

  it('cuts context to its cap, marking the cut', () => {
    const { stdout } = written(context('SessionStart', 'x'.repeat(100), 40));
    const { hookSpecificOutput } = JSON.parse(stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(hookSpecificOutput.additionalContext).toHaveLength(40);
    expect(hookSpecificOutput.additionalContext).toMatch(/…\(truncated\)$/);
  });

  it('keeps context within its cap whole', () => {
    expect(outcomeOf(context('SessionStart', 'Next step: x', 40))).toBe('context');
  });

  it.each<[Answer, string]>([
    [noAnswer(), 'allow'],
    [permission('ask', 'x'), 'ask'],
    [permission('deny', 'x'), 'deny'],
    [block('x'), 'block'],
    [refuse('x'), 'refuse'],
  ])('names what an answer does', (answer, outcome) => {
    expect(outcomeOf(answer)).toBe(outcome);
  });
});

describe('hook launch and failure policy (ADR-0015)', () => {
  it('fails both guards closed with ask', () => {
    expect(FAILURE_POLICY).toMatchObject({ 'guard-bash': 'ask', 'guard-secrets': 'ask' });
  });

  it('answers the payload on stdin', async () => {
    const { io, out } = capture([], { payload: {}, problem: 'stdin was not valid JSON' });
    expect(await launch('guard-bash', () => Promise.resolve(asking), io)).toBe(0);
    expect(outcomeOfStdout(out.stdout)).toBe('ask');
  });

  it('asks when a fail-closed hook cannot load', async () => {
    const { io, out } = capture();
    const code = await launch('guard-bash', () => Promise.reject(new SyntaxError('broken')), io);
    expect(code).toBe(0);
    expect(outcomeOfStdout(out.stdout)).toBe('ask');
    expect(out.stderr).toBe('guard-bash: could not do its job (SyntaxError)\n');
  });

  it('asks when a fail-closed hook throws while it answers', async () => {
    const { io, out } = capture();
    const throwing: HookModule = {
      answer: () => {
        throw new RangeError('boom');
      },
      samples: [],
    };
    await launch('guard-secrets', () => Promise.resolve(throwing), io);
    expect(outcomeOfStdout(out.stdout)).toBe('ask');
  });

  it('lets the action go on with a note when a fail-open hook cannot load', async () => {
    const { io, out } = capture();
    const code = await launch('memory', () => Promise.reject(new Error('x')), io, { memory: 'open' });
    expect({ code, ...out }).toEqual({
      code: 0,
      stdout: '',
      stderr: 'memory: could not do its job (Error)\n',
    });
  });

  it('runs its samples with --self-test and exits 0 when all pass', async () => {
    const { io, out } = capture(['--self-test']);
    expect(await launch('guard-bash', () => Promise.resolve(asking), io)).toBe(0);
    expect(out.stdout).toBe('guard-bash: 2 of 2 samples passed\n');
  });

  it('exits 1 from --self-test and names each sample that fails', async () => {
    const { io, out } = capture(['--self-test']);
    const wrong: HookModule = { ...asking, samples: [{ name: 'safe', payload: {}, expect: 'deny' }] };
    expect(await launch('guard-bash', () => Promise.resolve(wrong), io)).toBe(1);
    expect(out.stdout).toContain('FAIL guard-bash: safe: expected deny, got allow');
  });

  it('exits 1 from --self-test when the hook cannot load', async () => {
    const { io } = capture(['--self-test']);
    expect(await launch('guard-bash', () => Promise.reject(new Error('x')), io)).toBe(1);
  });
});

describe('project paths', () => {
  it.each<[NodeJS.ProcessEnv, string]>([
    [{ CLAUDE_PROJECT_DIR: '/work/p' }, '/work/p'],
    [{ CLAUDE_PROJECT_DIR: '' }, '/cwd'],
    [{}, '/cwd'],
  ])('takes the project folder from CLAUDE_PROJECT_DIR, else the working folder', (env, expected) => {
    expect(projectDirOf(env, '/cwd')).toBe(expected);
  });

  it('reports paths with forward slashes', () => {
    expect(slashed('C:\\Users\\me\\p')).toBe('C:/Users/me/p');
  });
});

function outcomeOfStdout(stdout: string): string {
  const output = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string } };
  return output.hookSpecificOutput?.permissionDecision ?? 'allow';
}
