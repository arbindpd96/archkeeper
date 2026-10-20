import { describe, expect, it } from 'vitest';
import { BRAND, type Brand } from '../src/core/brand.js';
import { configPath, parseConfig } from '../src/core/config.js';
import { ConfigError } from '../src/core/errors.js';
import { loadCatalog } from '../src/core/loader.js';
import { resolveOptions } from '../src/core/options.js';
import { hasControlCharacter } from '../src/core/paths.js';
import { isCommandList } from '../src/core/text.js';
import { kitFiles, memoryReader, plainManifest, richManifest, richSources } from './kit-fixtures.js';

const CONFIG = configPath();

function configError(text: string): ConfigError {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('the config parsed without an error');
}

const json = (value: unknown): string => JSON.stringify(value);
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);

describe('parseConfig', () => {
  it('reads a full config and fills the defaults of a minimal one', () => {
    const full = parseConfig(
      json({
        $schema: 'https://example.com/config.schema.json',
        version: 1,
        preset: 'small',
        modules: { add: ['knowledge'], remove: ['safety'] },
        stack: ['ts', 'python'],
        options: {
          safety: { optOut: ['Bash(rm -rf:*)'] },
          'stop-check': { stopTimeout: 120, commands: [['node', 'scripts/check.mjs'], ['pytest']] },
        },
        compose: { superpowers: true, specKit: false },
      }),
    );
    expect(full.warnings).toEqual([]);
    expect(full.config.modules).toEqual({ add: ['knowledge'], remove: ['safety'] });
    expect(full.config.options['stop-check']).toEqual({
      stopTimeout: 120,
      commands: [['node', 'scripts/check.mjs'], ['pytest']],
    });
    expect(parseConfig(json({ preset: 'medium' })).config).toEqual({
      preset: 'medium',
      modules: { add: [], remove: [] },
      options: {},
      compose: { superpowers: false, specKit: false },
    });
  });

  it('warns about unknown keys at every level and keeps going', () => {
    const { warnings } = parseConfig(
      json({ preset: 'small', theme: 'dark', modules: { add: [], drop: [] }, compose: { bmad: true } }),
    );
    expect(warnings.map((warning) => warning.location)).toEqual(['theme', 'modules.drop', 'compose.bmad']);
    expect(warnings[0]).toMatchObject({ file: CONFIG, problem: 'is not a known key, so it is ignored' });
  });

  it.each<[string, unknown, string, string]>([
    ['a missing preset', {}, 'preset', 'set preset to'],
    ['an empty preset', { preset: '' }, 'preset', 'set preset to'],
    ['a preset that is not an id', { preset: 'Medium Plus' }, 'preset', 'set preset to'],
    ['an unknown stack', { preset: 'small', stack: ['go'] }, 'stack[0]', 'use one of "ts", "python"'],
    [
      'modules.add that is not a list',
      { preset: 'small', modules: { add: 'knowledge' } },
      'modules.add',
      'a list',
    ],
    [
      'a module id that is not kebab-case',
      { preset: 'small', modules: { remove: ['Safety'] } },
      'modules.remove[0]',
      'kebab-case',
    ],
    [
      'an option value that is an object',
      { preset: 'small', options: { safety: { optOut: {} } } },
      'options.safety.optOut',
      'true or false, a number, a string, a list of strings or a list of commands',
    ],
    [
      'an option list that holds a number',
      { preset: 'small', options: { safety: { optOut: [1] } } },
      'options.safety.optOut',
      'true or false, a number, a string, a list of strings or a list of commands',
    ],
    [
      'an option list that mixes strings and commands',
      { preset: 'small', options: { 'format-on-edit': { commands: ['node', ['x.mjs']] } } },
      'options.format-on-edit.commands',
      'a list of commands',
    ],
    [
      'a compose choice that is not a boolean',
      { preset: 'small', compose: { superpowers: 'yes' } },
      'compose.superpowers',
      'a boolean',
    ],
    ['an older or unknown version', { preset: 'small', version: 0 }, 'version', 'set version to 1'],
    [
      'a version that is not a whole number',
      { preset: 'small', version: 1.5 },
      'version',
      'set version to 1',
    ],
    ['a config that is not an object', ['small'], '', 'schema/config.schema.json'],
  ])('rejects %s with a hint', (_name, value, location, fix) => {
    const error = configError(json(value));
    expect(error.file).toBe(CONFIG);
    expect(error.location).toBe(location);
    expect(error.hint).toContain(fix);
  });

  it('never prints the control characters of a preset it refuses', () => {
    const error = configError(json({ preset: `${ESC}]0;title${BEL}${ESC}[2K` }));
    expect(hasControlCharacter(error.message.replaceAll('\n', ' '))).toBe(false);
  });

  it('refuses a config written by a newer kit and says to upgrade', () => {
    const error = configError(json({ preset: 'small', version: 2 }));
    expect(error.message).toBe(
      `${CONFIG}: version: 2 is newer than this ${BRAND.displayName} understands (1)\n` +
        `Try: upgrade ${BRAND.displayName} (npx ${BRAND.npmName}@latest) and run it again`,
    );
  });

  it('reports invalid JSON with its line and column', () => {
    const error = configError('{\n  "preset": "small",\n}\n');
    expect(error.location).toBe('line 3, column 1');
    expect(error.message).toContain('no trailing commas');
  });

  it('names the config file under the brand it is given', () => {
    const brand: Brand = { ...BRAND, stateDir: '.acmekit' };
    expect(() => parseConfig('{}', brand)).toThrow('.acmekit/config.json: preset: ');
  });
});

describe('isCommandList', () => {
  it.each<[string, unknown, boolean]>([
    ['an empty list', [], true],
    ['commands that each name a program', [['node', 'x.mjs'], ['ruff']], true],
    ['a list holding an empty command', [['node', 'x.mjs'], []], false],
    ['a list of strings', ['node', 'x.mjs'], false],
    ['a command holding a number', [['node', 1]], false],
    ['a string', 'node x.mjs', false],
  ])('takes %s as a list of commands: %s', (_name, value, expected) => {
    expect(isCommandList(value)).toBe(expected);
  });
});

describe('resolveOptions', () => {
  const catalog = loadCatalog(
    ['base', 'rich'],
    memoryReader(kitFiles([plainManifest('base'), richManifest()], richSources())),
  );
  const options = (value: unknown): ReturnType<typeof resolveOptions> =>
    resolveOptions(parseConfig(json({ preset: 'small', options: value })).config, catalog);

  it('fills every module with its defaults and applies the config values', () => {
    const { options: resolved, warnings } = options({ rich: { blockNoVerify: true } });
    expect(warnings).toEqual([]);
    expect(resolved.get('rich')).toEqual({ blockNoVerify: true, optOut: [], timeout: 300, commands: [] });
    expect(resolved.get('base')).toEqual({});
  });

  it('applies a number and a list of commands, an empty list of commands included', () => {
    const commands = [['node', 'scripts/check-comments.mjs'], ['ruff']];
    expect(options({ rich: { timeout: 12.5, commands } }).options.get('rich')).toMatchObject({
      timeout: 12.5,
      commands,
    });
    expect(options({ rich: { optOut: [], commands: [] } }).options.get('rich')).toMatchObject({
      optOut: [],
      commands: [],
    });
  });

  it('warns about options for an unknown module or option and ignores them', () => {
    const { options: resolved, warnings } = options({ ghost: { x: true }, rich: { nope: true } });
    expect(warnings.map((warning) => [warning.location, warning.problem])).toEqual([
      ['options.ghost', 'is not a module, so its options are ignored'],
      ['options.rich.nope', 'is not an option of this module, so it is ignored'],
    ]);
    expect(resolved.get('rich')).toEqual({ blockNoVerify: false, optOut: [], timeout: 300, commands: [] });
  });

  it.each(['constructor', 'toString'])('warns about option %s, which only objects inherit', (name) => {
    const { warnings } = options({ rich: { [name]: true } });
    expect(warnings.map((warning) => warning.location)).toEqual([`options.rich.${name}`]);
  });

  it.each<[string, unknown, string, string]>([
    [
      'a string for a boolean option',
      { rich: { blockNoVerify: 'yes' } },
      'options.rich.blockNoVerify',
      'true or false',
    ],
    [
      'a string for a list option',
      { rich: { optOut: 'Bash(x)' } },
      'options.rich.optOut',
      'a list of strings',
    ],
    ['commands for a list option', { rich: { optOut: [['x']] } }, 'options.rich.optOut', 'a list of strings'],
    ['a string for a number option', { rich: { timeout: '300' } }, 'options.rich.timeout', 'a number'],
    [
      'a list of strings for a command-list option',
      { rich: { commands: ['node', 'x.mjs'] } },
      'options.rich.commands',
      'a list of commands, each a list of strings',
    ],
    [
      'an empty command, which names no program',
      { rich: { commands: [['node', 'x.mjs'], []] } },
      'options.rich.commands',
      'Extra commands to run.',
    ],
  ])('rejects %s, quoting the option description', (_name, value, location, fix) => {
    let caught: unknown;
    try {
      options(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).location).toBe(location);
    expect((caught as ConfigError).hint).toContain(fix);
  });
});
