import { mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { guardBash } from '../src/hooks/runtime/bash/guard.js';
import { canSymlink, tempDir } from './helpers.js';
import { bashContext, bashVerdict, hookAnswer, PROJECT } from './hook-helpers.js';

const DANGEROUS_DELETE = /Recursive delete of a root/;
const PROJECT_NAME = path.posix.basename(PROJECT);

function expectDecision(command: string, expected: string, context = bashContext()): void {
  const { decision, reason } = bashVerdict(command, context);
  expect(decision).toBe(expected);
  if (decision === 'deny') expect(reason).toMatch(DANGEROUS_DELETE);
}

// The project is /home/u/work/project-x and each command runs in it, unless a row says otherwise.
describe('guard-bash: relative delete targets', () => {
  it.each([
    [`rm -fr ../${PROJECT_NAME}`, 'deny'],
    [`rm -r ../${PROJECT_NAME}`, 'deny'],
    [`rm -R ../${PROJECT_NAME}/`, 'deny'],
    ['rm -fr ../../work', 'deny'],
    ['rm -rf ../../..', 'deny'],
    [`rm -rf $PWD/../${PROJECT_NAME}`, 'deny'],
    [`find ../${PROJECT_NAME} -delete`, 'deny'],
    [`find ../${PROJECT_NAME} -type f -print0 | xargs -0 rm -f`, 'deny'],
    ['rm -rf ../other-project', 'allow'],
    ['rm -rf dist ./build src/*.o', 'allow'],
    [`rm -rf $CLAUDE_PROJECT_DIR/build`, 'allow'],
    [`rm ../${PROJECT_NAME}`, 'allow'],
  ])('judges %s from the session folder → %s', (command, expected) => {
    expectDecision(command, expected);
  });

  const inSource = bashContext({}, { cwd: `${PROJECT}/src` });
  it.each([
    [`rm -rf ../../${PROJECT_NAME}`, 'deny'],
    ['rm -rf ../..', 'deny'],
    ['rm -rf .', 'deny'],
    ['rm -rf build', 'allow'],
    ['rm -rf ../dist', 'allow'],
  ])('judges %s from a subfolder of the project → %s', (command, expected) => {
    expectDecision(command, expected, inSource);
  });
});

describe('guard-bash: cd and pushd before a delete', () => {
  it.each([
    [`cd .. && rm -r ${PROJECT_NAME}`, 'deny'],
    [`cd .. && rm -fr ${PROJECT_NAME}`, 'deny'],
    ['cd ~ && rm -r work', 'deny'],
    ['cd && rm -rf work', 'deny'],
    ['cd / && rm -r usr', 'deny'],
    ['cd /; rm -rf home', 'deny'],
    [`pushd .. && rm -rf ${PROJECT_NAME}`, 'deny'],
    [`cd -P .. && rm -rf -- ${PROJECT_NAME}`, 'deny'],
    [`cd src; cd ..; cd ..; rm -rf ${PROJECT_NAME}`, 'deny'],
    [`cd $CLAUDE_PROJECT_DIR/.. && rm -rf ${PROJECT_NAME}`, 'deny'],
    [`cd .. && find ${PROJECT_NAME} -delete`, 'deny'],
    [`(cd .. && rm -rf ${PROJECT_NAME})`, 'deny'],
    ["sh -c 'cd ~ && rm -fr work'", 'deny'],
    [`f() { cd ..; }; f; rm -rf ${PROJECT_NAME}`, 'deny'],
    ['cd .. && rm -fr other-project', 'allow'],
    ['cd src && rm -rf build', 'allow'],
    ['cd / && rm -rf tmp/scratch', 'allow'],
    [`cd .. && find ${PROJECT_NAME} -name '*.o' -delete`, 'allow'],
    ['pushd .. && popd && rm -rf build', 'allow'],
  ])('follows the folder through %s → %s', (command, expected) => {
    expectDecision(command, expected);
  });

  it.each([
    'cd "$DIR" && rm -rf build',
    'cd $(git rev-parse --show-toplevel) && rm -r dist',
    'cd - && rm -rf build',
    'cd ~bob && rm -rf build',
    'cd src/* && rm -rf build',
    '"$TOOL" .. && rm -rf build',
    'cd "$DIR" && find build -delete',
  ])('asks when a folder decided at run time comes before a relative recursive delete: %s', (command) => {
    expect(bashVerdict(command).decision).toBe('ask');
  });

  it.each(['cd "$DIR" && rm -f build.log', 'cd "$DIR" && rm -rf /tmp/scratch', 'cd "$DIR" && npm test'])(
    'allows %s, which deletes nothing relative and recursively',
    (command) => {
      expect(bashVerdict(command).decision).toBe('allow');
    },
  );
});

describe('guard-bash: protected folders under their real paths', () => {
  const linked = bashContext({}, { project: '/tmp/a/proj', realDirs: ['/private/tmp/a/proj'] });
  it.each([
    ['rm -rf /private/tmp/a/proj', 'deny'],
    ['rm -rf /private/tmp/a', 'deny'],
    ['rm -rf /tmp/a/proj', 'deny'],
    ['rm -rf /private/tmp/a/other', 'allow'],
  ])('judges %s when the project is /tmp/a/proj, really /private/tmp/a/proj → %s', (command, expected) => {
    expectDecision(command, expected, linked);
  });

  it.runIf(canSymlink())('denies deleting the project through the real path of a linked folder', () => {
    const root = tempDir();
    const realProject = path.join(root, 'real', 'proj');
    mkdirSync(realProject, { recursive: true });
    const link = path.join(root, 'link');
    symlinkSync(path.join(root, 'real'), link);
    const payload = { tool_name: 'Bash', tool_input: { command: `rm -rf ${realpathSync(realProject)}` } };
    expect(hookAnswer(guardBash, payload, { projectDir: path.join(link, 'proj') }).outcome).toBe('deny');
  });

  it('resolves a relative target against the cwd the payload names', () => {
    const project = path.join(tempDir(), 'proj');
    mkdirSync(project);
    const payload = { tool_name: 'Bash', tool_input: { command: 'rm -rf proj' }, cwd: path.dirname(project) };
    expect(hookAnswer(guardBash, payload, { projectDir: project }).outcome).toBe('deny');
  });
});
