/** What a guard rule decides about a command: deny it, or ask the user, with the reason Claude sees. */
export interface Verdict {
  readonly decision: 'deny' | 'ask';
  readonly reason: string;
}

/** A verdict that blocks the command. */
export function deny(reason: string): Verdict {
  return Object.freeze({ decision: 'deny', reason });
}

/** A verdict that asks the user to confirm the command. */
export function ask(reason: string): Verdict {
  return Object.freeze({ decision: 'ask', reason });
}

/** The verdict to report from several rules: the first deny, else the first ask, else null. */
export function strictest(verdicts: readonly (Verdict | null)[]): Verdict | null {
  const found = verdicts.filter((verdict): verdict is Verdict => verdict !== null);
  return found.find((verdict) => verdict.decision === 'deny') ?? found[0] ?? null;
}
