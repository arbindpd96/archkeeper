import { confirm, isCancel, select } from '@clack/prompts';

/** One answer a select prompt offers. */
export interface Choice<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly hint?: string;
}

/** The questions a command may ask; each resolves to undefined when the user cancels, as with Ctrl+C. */
export interface Prompter {
  readonly select: <Value extends string>(
    message: string,
    choices: readonly Choice<Value>[],
    initial: Value,
  ) => Promise<Value | undefined>;
  readonly confirm: (message: string, initial: boolean) => Promise<boolean | undefined>;
}

/**
 * Asks on the terminal with `@clack/prompts` (#27). Only ever called when stdin is a TTY: with a non-TTY stdin a
 * clack prompt never resolves and Node.js exits with code 13 (reference §7.1).
 */
export const CLACK_PROMPTER: Prompter = {
  select: async (message, choices, initial) => {
    const options = choices.map(({ value, label, hint }) => ({
      value,
      label,
      ...(hint === undefined ? {} : { hint }),
    }));
    const answer = await select<string>({ message, options, initialValue: initial });
    // Every option's value is a Value, so the answer is one too.
    return isCancel(answer) ? undefined : (answer as typeof initial);
  },
  confirm: async (message, initial) => {
    const answer = await confirm({ message, initialValue: initial });
    return isCancel(answer) ? undefined : answer;
  },
};
