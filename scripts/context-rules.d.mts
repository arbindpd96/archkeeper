/** Characters per token in the estimate ADR-0017 fixes. */
export declare const CHARS_PER_TOKEN: number;

/** The always-on context of a project in characters by part, in total, and in tokens. */
export interface AlwaysOnContext {
  readonly instructions: number;
  readonly rules: number;
  readonly skills: number;
  readonly sessionStart: number;
  readonly chars: number;
  readonly tokens: number;
}

/** The `@path` imports Claude Code 2.1.295 reads in a memory file, as written: cut at `#`, unescaped, trimmed. */
export declare function importsOf(text: string): string[];

/** Estimates the context Claude Code loads in every session of the project at `root` (ADR-0017). */
export declare function alwaysOnContext(root: string, sessionStartCap: number): AlwaysOnContext;
