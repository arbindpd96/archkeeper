/** Where a command sits: the id of its pipeline and its stage there, 0 for the first command. */
export interface PipePosition {
  readonly pipeline: number;
  readonly stage: number;
}

/** One simple command as the tokenizer reads it, before wrappers and braces are resolved. */
export interface RawCommand {
  /** Words with quotes removed; substitutions are kept as their source text. */
  argv: string[];
  /** For each word, the indexes of its unquoted brace syntax. */
  braces: number[][];
  /** For each word, whether it holds an unquoted expansion, which the shell splits at run time. */
  splits: boolean[];
  /** For each word, whether it holds any expansion or substitution, quoted or not. */
  expands: boolean[];
  /** Redirect targets. */
  redirects: string[];
  /** Here-document and here-string bodies. */
  heredocs: string[];
  /** Commands that substitutions in its words run. */
  subs: RawCommand[];
  /** Its own pipeline position, then one for each enclosing group or substitution. */
  pipes: PipePosition[];
  /** A function name (`f() …` or `function f …`) rather than a command that runs. */
  definesFunction: boolean;
}

/** An empty raw command. */
export function newCommand(): RawCommand {
  return {
    argv: [],
    braces: [],
    splits: [],
    expands: [],
    redirects: [],
    heredocs: [],
    subs: [],
    pipes: [],
    definesFunction: false,
  };
}
