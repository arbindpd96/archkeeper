import { describe, expect, it } from 'vitest';
import { BRAND, type Brand } from '../src/core/brand.js';
import { configPath, parseConfig } from '../src/core/config.js';
import { ConfigError } from '../src/core/errors.js';
import { loadCatalog } from '../src/core/loader.js';
import { resolveOptions } from '../src/core/options.js';
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

describe('parseConfig', () => {
  it('reads a full config and fills the defaults of a minimal one', () => {
    const full = parseConfig(
      json({
        $schema: 'https://example.com/config.schema.json',
        version: 1,
        preset: 'small',
        modules: { add: ['knowledge'], remove: ['safety'] },
        stack: ['ts', 'python'],
        options: { safety: { optOut: ['Bash(rm -rf:*)'] } },
        compose: { superpowers: true, specKit: false },
      }),
    );
    expect(full.warnings).toEqual([]);
    expect(full.config.modules).toEqual({ add: ['knowledge'], remove: ['safety'] });
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
      'true or false, a string, or a list of strings',
    ],
    [
      'an option list that holds a number',
      { preset: 'small', options: { safety: { optOut: [1] } } },
      'options.safety.optOut',
      'true or false, a string, or a list of strings',
    ],
    [
      'a compose choice that is not a boolean',
      { preset: 'small', compose: { superpowers: 'yes' } },
      'compose.superpowers',
      'a boolean',
    ],
    ['an older or unknown version', { preset: 'small', version: 0 }, 'version', 'set version to 1'],
    ['a config that is not an object', ['small'], '', 'schema/config.schema.json'],
  ])('rejects %s with a hint', (_name, value, location, fix) => {
    const error = configError(json(value));
    expect(error.file).toBe(CONFIG);
    expect(error.location).toBe(location);
    expect(error.hint).toContain(fix);
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
    expect(resolved.get('rich')).toEqual({ blockNoVerify: true, optOut: [] });
    expect(resolved.get('base')).toEqual({});
  });

  it('warns about options for an unknown module or option and ignores them', () => {
    const { options: resolved, warnings } = options({ ghost: { x: true }, rich: { nope: true } });
    expect(warnings.map((warning) => [warning.location, warning.problem])).toEqual([
      ['options.ghost', 'is not a module, so its options are ignored'],
      ['options.rich.nope', 'is not an option of this module, so it is ignored'],
    ]);
    expect(resolved.get('rich')).toEqual({ blockNoVerify: false, optOut: [] });
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
