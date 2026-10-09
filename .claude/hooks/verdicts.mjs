/** Builds a frozen verdict that blocks the command. */
export const deny = (reason) => Object.freeze({ decision: 'deny', reason });

/** Builds a frozen verdict that asks the user to confirm the command. */
export const ask = (reason) => Object.freeze({ decision: 'ask', reason });

/** Picks the verdict to report from several rules: the first deny, else the first ask, else null. */
export function strictest(verdicts) {
  const found = verdicts.filter(Boolean);
  return found.find((verdict) => verdict.decision === 'deny') ?? found[0] ?? null;
}
