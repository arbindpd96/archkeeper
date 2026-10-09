/** What is wrong where, and the fix: the location is a JSON path such as `hooks[0].event`, or a line. */
export interface Finding {
  readonly location: string;
  readonly problem: string;
  readonly hint: string;
}

/** A finding together with the file it is in. */
export interface ProblemReport extends Finding {
  readonly file: string;
}

/**
 * Base of every error the kit raises on purpose. The message is the line the CLI prints, naming the file and
 * the location, followed by a `Try:` line with the fix (#26).
 */
export class ArchkeeperError extends Error {
  override readonly name: string = 'ArchkeeperError';
  readonly file: string;
  readonly location: string;
  readonly hint: string;

  constructor({ file, location, problem, hint }: ProblemReport) {
    const where = location === '' ? file : `${file}: ${location}`;
    super(`${where}: ${problem}\nTry: ${hint}`);
    this.file = file;
    this.location = location;
    this.hint = hint;
  }
}

/** A module manifest or `modules/presets.json` that is not valid JSON or breaks the manifest contract (#18). */
export class ManifestError extends ArchkeeperError {
  override readonly name = 'ManifestError';
}

/** A project config that is not valid JSON or holds a value the kit cannot use (#19). */
export class ConfigError extends ArchkeeperError {
  override readonly name = 'ConfigError';
}

/** A module set that cannot be resolved: a missing dependency, a cycle or a conflict, shown as a chain (#19). */
export class ResolveError extends ArchkeeperError {
  override readonly name = 'ResolveError';
  /** The path that led to the problem, such as `preset medium`, `knowledge`, `base`. */
  readonly chain: readonly string[];

  constructor(report: ProblemReport & { readonly chain: readonly string[] }) {
    super(report);
    this.chain = report.chain;
  }
}

/** A template, path or output the renderer cannot produce (#20). */
export class RenderError extends ArchkeeperError {
  override readonly name = 'RenderError';
}

/** A file the kit cannot merge into without risking a user byte, such as broken markers or malformed JSON (#22). */
export class MergeError extends ArchkeeperError {
  override readonly name = 'MergeError';
}

/** A write or delete target the kit refuses: outside the project, inside `.git`, or unsafe on some OS (#23). */
export class PathSafetyError extends ArchkeeperError {
  override readonly name = 'PathSafetyError';
}

/** A lock the kit cannot use: invalid, or written by a newer lockfile version or kit (#24). */
export class LockError extends ArchkeeperError {
  override readonly name = 'LockError';
}

/** A file operation that failed while applying a plan, after every touched path was restored (#24). */
export class ApplyError extends ArchkeeperError {
  override readonly name = 'ApplyError';
}
