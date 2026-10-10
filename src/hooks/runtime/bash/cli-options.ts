/** The options of a program that take a value: short letters and long names. */
export interface OptionSpec {
  readonly short?: string;
  readonly long?: readonly string[];
}

/** Arguments split GNU-style. */
export interface ParsedOptions {
  readonly short: Set<string>;
  readonly long: Set<string>;
  /** Each option that took a value, with the value. */
  readonly values: [name: string, value: string][];
  readonly operands: string[];
  afterDashes: string[];
}

function readLongOption(
  arg: string,
  next: string | undefined,
  spec: OptionSpec,
  parsed: ParsedOptions,
): number {
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg : arg.slice(0, equals);
  parsed.long.add(name);
  if (equals !== -1) parsed.values.push([name, arg.slice(equals + 1)]);
  if (equals !== -1 || spec.long?.includes(name) !== true) return 0;
  parsed.values.push([name, next ?? '']);
  return 1;
}

function readOption(arg: string, next: string | undefined, spec: OptionSpec, parsed: ParsedOptions): number {
  if (arg.startsWith('--')) return readLongOption(arg, next, spec, parsed);
  for (let at = 1; at < arg.length; at += 1) {
    const letter = arg[at] ?? '';
    parsed.short.add(letter);
    if (spec.short?.includes(letter) !== true) continue;
    const attached = arg.slice(at + 1);
    parsed.values.push([`-${letter}`, attached || (next ?? '')]);
    return attached ? 0 : 1;
  }
  return 0;
}

/**
 * Splits arguments GNU-style into `short` flags, `long` option names, `values`, `operands` and `afterDashes`.
 * `spec` lists the options that take a value.
 */
export function parseOptions(args: readonly string[], spec: OptionSpec = {}): ParsedOptions {
  const parsed: ParsedOptions = {
    short: new Set(),
    long: new Set(),
    values: [],
    operands: [],
    afterDashes: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--') {
      parsed.afterDashes = args.slice(index + 1);
      break;
    }
    if (arg.length > 1 && arg.startsWith('-')) index += readOption(arg, args[index + 1], spec, parsed);
    else parsed.operands.push(arg);
  }
  return parsed;
}

/** Tells whether a long option was given in full or as an abbreviation at least `shortest` characters long. */
export function hasLong(options: ParsedOptions, name: string, shortest = name.length): boolean {
  return [...options.long].some((given) => given.length >= shortest && name.startsWith(given));
}
