const MAX_COMMAND_LENGTH = 8000;
const AI_ATTRIBUTION =
  /co-authored-by:[^\n]*(?:claude|noreply@anthropic\.com)|generated\s+(?:with|by)\s+\[?claude\s+code/i;

const TOO_LONG = {
  decision: 'ask',
  reason: 'This command is too long to inspect safely. Confirm with the user.',
};
const AI_AUTHORED = {
  decision: 'deny',
  reason: 'Commits and PRs are authored by the maintainer. Remove the Claude attribution line.',
};

async function judge() {
  const [{ readInput }, { judgeCommands }, { parseCommands }] = await Promise.all([
    import('./lib.mjs'),
    import('./bash-rules.mjs'),
    import('./shell-commands.mjs'),
  ]);
  const command = readInput()?.tool_input?.command;
  if (typeof command !== 'string') return null;
  if (command.length > MAX_COMMAND_LENGTH) return TOO_LONG;
  if (AI_ATTRIBUTION.test(command)) return AI_AUTHORED;
  return judgeCommands(parseCommands(command));
}

async function judgeSafely() {
  try {
    return await judge();
  } catch (error) {
    // Fail closed: a guard that cannot load, crashes or cannot parse must not silently allow the command.
    const detail =
      error?.name === 'ShellSyntaxError' ? `it has ${error.message}` : 'the guard hit an internal error';
    return {
      decision: 'ask',
      reason: `This command could not be inspected safely (${detail}). Confirm with the user.`,
    };
  }
}

const verdict = await judgeSafely();

if (verdict) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.decision,
        permissionDecisionReason: `archkeeper guard: ${verdict.reason}`,
      },
    }),
  );
}
