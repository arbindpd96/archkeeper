/** How the README shows a command: the tape that renders its GIF and the README section that embeds it. */
export interface CommandDemo {
  readonly tape: string;
  readonly section: string;
}

/**
 * One CLI command in the registry (#26): a user-facing command declares its demo, and one without a README
 * section yet is `internal: true`. `scripts/check-demos.mjs` reads this file with Node's type stripping, so it
 * imports nothing.
 */
export interface CommandInfo {
  readonly name: string;
  readonly summary: string;
  readonly demo?: CommandDemo;
  readonly internal?: true;
}

/** Every command the CLI has; `main` registers exactly these, and check-demos holds each to the demo rule. */
export const COMMANDS: readonly CommandInfo[] = [
  {
    name: 'init',
    summary: 'Detect the stack, show the plan and set up Claude Code in this project',
    demo: { tape: 'init', section: 'Quick start' },
  },
];
