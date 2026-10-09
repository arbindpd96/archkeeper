function recordValue(parsed, name, value) {
  parsed.values.push([name, value]);
}

function readLongOption(arg, next, spec, parsed) {
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg : arg.slice(0, equals);
  parsed.long.add(name);
  if (equals !== -1) recordValue(parsed, name, arg.slice(equals + 1));
  if (equals !== -1 || !spec.long?.includes(name)) return 0;
  recordValue(parsed, name, next ?? '');
  return 1;
}

function readOption(arg, next, spec, parsed) {
  if (arg.startsWith('--')) return readLongOption(arg, next, spec, parsed);
  for (let at = 1; at < arg.length; at += 1) {
    parsed.short.add(arg[at]);
    if (!spec.short?.includes(arg[at])) continue;
    const attached = arg.slice(at + 1);
    recordValue(parsed, `-${arg[at]}`, attached || (next ?? ''));
    return attached ? 0 : 1;
  }
  return 0;
}

/**
 * Splits arguments GNU-style into `short` flags, `long` option names, `values` ([option, value] pairs),
 * `operands` and `afterDashes`. `spec.short` and `spec.long` list the options that take a value.
 */
export function parseOptions(args, spec = {}) {
  const parsed = { short: new Set(), long: new Set(), values: [], operands: [], afterDashes: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
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
export function hasLong(options, name, shortest = name.length) {
  return [...options.long].some((given) => given.length >= shortest && name.startsWith(given));
}
