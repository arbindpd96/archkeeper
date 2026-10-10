import { describe, expect, it } from 'vitest';
import { moduleChanges, stackFlag } from '../src/cli/init-answers.js';
import type { ProjectConfig } from '../src/core/config-schema.js';
import { UsageError } from '../src/core/errors.js';
import { KIT } from './init-helpers.js';

function configWith(add: string[], remove: string[]): ProjectConfig {
  return {
    preset: 'medium',
    modules: { add, remove },
    options: {},
    compose: { superpowers: false, specKit: false },
  };
}

describe('stackFlag', () => {
  it('reads no flag as undefined, so detection decides', () => {
    expect(stackFlag(undefined)).toBeUndefined();
  });

  it.each(['none', ' none '])('reads %j as no stack', (value) => {
    expect(stackFlag(value)).toEqual([]);
  });

  it.each(['ts,python', 'python, ts', 'ts,python,ts'])(
    'reads %j as both stacks in a fixed order',
    (value) => {
      expect(stackFlag(value)).toEqual(['ts', 'python']);
    },
  );

  it('refuses none together with a stack', () => {
    expect(() => stackFlag('none,ts')).toThrow(UsageError);
    expect(() => stackFlag('none,ts')).toThrow('"none" cannot go with a stack');
  });
});

describe('moduleChanges', () => {
  it('adds a bare id as +id does', () => {
    expect(moduleChanges('stop-check', undefined, KIT)).toEqual({ add: ['stop-check'], remove: [] });
  });

  it('starts from the config lists and moves an id from one list to the other', () => {
    const config = configWith(['stop-check'], ['knowledge']);
    expect(moduleChanges('knowledge,-stop-check', config, KIT)).toEqual({
      add: ['knowledge'],
      remove: ['stop-check'],
    });
  });

  it('lets a later -id undo an earlier +id and keeps the config lists free of duplicates', () => {
    const config = configWith(['stop-check'], ['knowledge']);
    expect(moduleChanges('+stop-check,+safety,-safety', config, KIT)).toEqual({
      add: ['stop-check'],
      remove: ['knowledge', 'safety'],
    });
  });

  it('keeps the config lists when the flag is absent', () => {
    const config = configWith(['stop-check'], ['knowledge']);
    expect(moduleChanges(undefined, config, KIT)).toEqual({ add: ['stop-check'], remove: ['knowledge'] });
  });
});
