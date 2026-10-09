import { readInput, respond } from './lib.mjs';

const RULES = [
  {
    decision: 'deny',
    pattern: /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive\s+--force|--force\s+--recursive)\s+(\/|~|\$HOME|\*|\.{1,2})(\s|\/?$)/i,
    reason: 'Recursive force-delete of a root, home or whole-directory path is blocked.',
  },
  {
    decision: 'deny',
    pattern: /\bgit\s+push\b(?=.*\s(-f|--force)(\s|$))/,
    reason: 'Plain force-push is blocked. Use --force-with-lease on a feature branch.',
  },
  {
    decision: 'deny',
    pattern: /\bgit\s+push\b(?=.*--force-with-lease)(?=.*\b(main|master)\b)/,
    reason: 'Force-pushing main/master is blocked.',
  },
  {
    decision: 'deny',
    pattern: /\bgit\s+(commit|push)\b.*\s--no-verify\b/,
    reason: '--no-verify skips the quality gates. Fix the failing check instead.',
  },
  {
    decision: 'deny',
    pattern: /co-authored-by:\s*claude|generated with \[?claude code/i,
    reason: 'Commits and PRs are authored by the maintainer. Remove the Claude attribution line.',
  },
  {
    decision: 'deny',
    pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    reason: 'Piping a download into a shell is blocked. Download, review, then run.',
  },
  {
    decision: 'deny',
    pattern: /\bgh\s+(repo|release)\s+delete\b/,
    reason: 'Deleting repositories or releases is blocked.',
  },
  {
    decision: 'deny',
    pattern: /\bchmod\s+(-R\s+)?777\b/,
    reason: 'World-writable permissions are blocked.',
  },
  {
    decision: 'ask',
    pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s+\.|restore\s+\.|branch\s+-D|stash\s+(drop|clear))\b/,
    reason: 'This discards work irreversibly. Confirm with the user.',
  },
  {
    decision: 'ask',
    pattern: /\bnpm\s+(publish|unpublish|deprecate|dist-tag)\b/,
    reason: 'Publishing to npm is outward-facing. Confirm with the user.',
  },
  {
    decision: 'ask',
    pattern: /(^|[;&|]\s*)sudo\s/,
    reason: 'sudo needs explicit user approval.',
  },
];

const command = readInput().tool_input?.command ?? '';
const match = RULES.find((rule) => rule.pattern.test(command));

if (match) {
  respond({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: match.decision,
      permissionDecisionReason: `claude-codekit guard: ${match.reason}`,
    },
  });
}
