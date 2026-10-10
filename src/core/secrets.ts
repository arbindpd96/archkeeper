interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

// One list for the renderer and the guard-secrets hook (#32). Patterns that need text after an unbounded run start
// at a lookbehind, so each run of token characters is tried once and a scan stays linear (ADR-0015).
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'AWS access key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret key', pattern: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i },
  { name: 'GitHub token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: 'Slack token', pattern: /\b(xox[abprs]-[A-Za-z0-9-]{10,}|xapp-\d-[A-Za-z0-9-]{10,})/ },
  { name: 'Slack webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/ },
  { name: 'Stripe secret', pattern: /\b([sr]k_live_[0-9a-zA-Z]{24,}|whsec_[A-Za-z0-9]{24,})/ },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'npm token', pattern: /\bnpm_[A-Za-z0-9]{36}|_authToken\s*=\s*[^\s$]{8,}/ },
  { name: 'private key', pattern: /-----BEGIN ([A-Z]+ )*PRIVATE KEY( BLOCK)?-----/ },
  {
    name: 'JWT',
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: 'credentialed URL',
    pattern:
      /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]+:(?![$<{]|(password|pass|secret|changeme)@)[^\s@/]{3,}@/i,
  },
];

/** A likely secret in a text: its kind and its line, never the secret itself. */
export interface SecretFinding {
  readonly name: string;
  readonly line: number;
}

/** Names the kinds of likely secret one line holds, such as a GitHub token, never the secret itself. */
export function secretKinds(line: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name);
}

/** Finds the first line of `text` that holds a likely secret, such as a GitHub token or a private key. */
export function findSecret(text: string): SecretFinding | undefined {
  for (const [index, line] of text.split('\n').entries()) {
    const [name] = secretKinds(line);
    if (name !== undefined) return { name, line: index + 1 };
  }
  return undefined;
}
