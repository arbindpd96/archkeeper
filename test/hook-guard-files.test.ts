import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { guardSecrets } from '../src/hooks/runtime/secrets/guard.js';
import { tempDir } from './helpers.js';
import { bashContext, bashVerdict, hookAnswer, PROJECT } from './hook-helpers.js';

const HOOKS = BRAND.hookDir;
const SLUG = HOOKS.split('/').at(-1) ?? '';
const CONFIG = `${BRAND.stateDir}/config.json`;
const GUARD_FILES = /changes the guards themselves/;

describe('guard-bash on commands that change the guards themselves', () => {
  it.each([
    `rm ${HOOKS}/guard-bash.mjs`,
    `rm -f ./${HOOKS}/*.mjs`,
    `: > ${HOOKS}/guard-bash.mjs`,
    `echo '{}' > .claude/settings.json`,
    `echo x >> .claude/settings.local.json`,
    `mv ${HOOKS} /tmp/off`,
    `cp /dev/null ${HOOKS}/guard-secrets.mjs`,
    `truncate -s 0 ${HOOKS}/guard-bash.mjs`,
    `sed -i 's/deny/allow/' ${HOOKS}/guard-bash.mjs`,
    `printf '{}' | tee ${CONFIG}`,
    `dd if=/dev/null of=${HOOKS}/guard-bash.mjs`,
    `rm -r .claude`,
    `rm -rf .claude/hooks`,
    `rm .claude/*/${SLUG}/guard-bash.mjs`,
    `cd .claude && rm hooks/${SLUG}/guard-bash.mjs`,
    `cd .claude/hooks/${SLUG} && rm guard-bash.mjs`,
    `rm ${PROJECT}/${HOOKS}/guard-bash.mjs`,
    `chmod 000 ${HOOKS}/guard-bash.mjs`,
    `cp -t ${HOOKS} evil.mjs`,
    `cat a > /dev/null <> .claude/settings.json`,
    `find ${HOOKS} -delete`,
    `find .claude -name '*.mjs' -exec rm {} +`,
    `find .claude -execdir mv {} /tmp \\;`,
    `ln -sf /tmp/e.mjs ${HOOKS}/guard-bash.mjs`,
    `install -m 755 e.mjs ${HOOKS}/guard-bash.mjs`,
    `cp --target-directory=${HOOKS} e.mjs`,
    `cd ${HOOKS} && ln -sf /tmp/x/guard-bash.mjs`,
    `cd .claude && ln -s /tmp/x/settings.json`,
  ])('asks before %s', (command) => {
    const { decision, reason } = bashVerdict(command);
    expect(decision).toBe('ask');
    expect(reason).toMatch(GUARD_FILES);
  });

  it.each([
    `cat ${HOOKS}/guard-bash.mjs`,
    `node ${HOOKS}/guard-bash.mjs --self-test`,
    `grep -n deny .claude/settings.json`,
    `sed -n 1p .claude/settings.json`,
    `rm -f *`,
    `rm -rf .claude/worktrees/old`,
    `cp notes.md .`,
    `mv a.ts src/`,
    `rm -f dist/settings.json`,
    `jq . < .claude/settings.json`,
    `cp .claude/settings.json /tmp/settings.bak`,
    `rsync -a ${HOOKS}/ /tmp/hooks-copy/`,
    `find .claude -name '*.md' -print`,
    `find .claude/worktrees -delete`,
    `mv a.ts b.ts`,
    `rsync -a src/ dist/`,
    `ln -s ${HOOKS}/guard-bash.mjs /tmp/link`,
    'ln -s /tmp/x/guard-bash.mjs',
  ])('allows %s', (command) => {
    expect(bashVerdict(command).decision).toBe('allow');
  });

  it.each([
    'cd .. && mv project-x project-x.bak',
    `mv ${PROJECT} /tmp/x`,
    'mv ~/work ~/work2',
    'mv . ../elsewhere',
    'rsync -a --delete empty/ ./',
    'rsync -a ../template/ .',
    'mv -t /tmp $CLAUDE_PROJECT_DIR',
    'rsync -a --delete empty/ . -T /tmp',
    'rsync -a --backup-dir /tmp/b ../template/ .',
    'rsync -a --exclude-from list.txt ../template/ ./',
    'rsync -a x/ ~/',
  ])('asks before %s, which moves or overwrites the folder that holds the guards', (command) => {
    const { decision, reason } = bashVerdict(command);
    expect(decision).toBe('ask');
    expect(reason).toMatch(/home or project folder, or a folder above one/);
  });

  it.each([`rsync -a --files-from list.txt src/ dist/`, 'rsync -a -T /tmp src/ dist/'])(
    'allows %s, whose option values are not its destination',
    (command) => {
      expect(bashVerdict(command).decision).toBe('allow');
    },
  );

  it('asks before moving a folder above a project that lives under it', () => {
    const context = bashContext({}, { project: '/home/u/Documents/proj' });
    expect(bashVerdict('mv ~/Documents ~/Docs2', context).decision).toBe('ask');
  });

  it.each(['cp x .', 'mv notes.md .', 'cp -r ../lib .', 'mv ~/Downloads/a.ts src/'])(
    'allows %s',
    (command) => {
      expect(bashVerdict(command).decision).toBe('allow');
    },
  );

  it('asks from a session folder inside .claude', () => {
    const context = bashContext({}, { cwd: `${PROJECT}/.claude` });
    expect(bashVerdict('rm settings.json', context).decision).toBe('ask');
  });
});

describe('guard-secrets on writes that change the guards themselves', () => {
  const write = (file_path: string): { outcome: string; reason: string } =>
    hookAnswer(
      guardSecrets,
      { tool_name: 'Write', tool_input: { file_path, content: '{}\n' } },
      { projectDir: tempDir() },
    );

  it.each([`${HOOKS}/guard-bash.mjs`, '.claude/settings.json', '.claude/settings.local.json', CONFIG])(
    'asks before writing %s',
    (file) => {
      const { outcome, reason } = write(file);
      expect(outcome).toBe('ask');
      expect(reason).toContain('keeps the guards running');
    },
  );

  it.each(['.claude/agents/reviewer.md', 'src/settings.json', `${BRAND.stateDir}/lock.json`])(
    'allows writing %s',
    (file) => {
      expect(write(file).outcome).toBe('allow');
    },
  );
});
