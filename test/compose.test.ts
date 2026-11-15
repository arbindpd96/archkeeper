import { describe, expect, it } from 'vitest';
import { readKit } from '../src/cli/kit.js';
import type { ComposeCatalog } from '../src/core/compose-schema.js';
import { ManifestError } from '../src/core/errors.js';
import { loadCatalog, templatePath } from '../src/core/loader.js';
import { REPO_ROOT } from './helpers.js';
import { composeData, kitFiles, type ManifestData, memoryReader, plainManifest } from './kit-fixtures.js';
import { frontmatterOf } from './static-rules.js';

const catalog = readKit(REPO_ROOT);
const SKILL_FILE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;

// Checked with gh on 2026-10-19: the skill folders of obra/superpowers at its v7.0.0 tag.
const SUPERPOWERS_SKILLS = [
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
];

/** Each skill the kit writes, by the folder its SKILL.md goes to and by its frontmatter `name:`. */
function kitSkillNames(): string[] {
  return [...catalog.modules.values()].flatMap((kit) =>
    kit.manifest.files.flatMap((file) => {
      const folder = SKILL_FILE.exec(file.to)?.[1];
      if (folder === undefined) return [];
      const text = file.from === undefined ? '' : kit.sources.get(templatePath(kit.manifest.id, file.from));
      const name = frontmatterOf(text ?? '')?.get('name');
      return [folder, ...(typeof name === 'string' ? [name] : [])];
    }),
  );
}

/** The tool whose skills a name would clash with: a recorded skill name, or a name with one of its prefixes. */
function clashOf(name: string, compose: ComposeCatalog): string | undefined {
  const tools = [compose.superpowers, compose.specKit];
  const clash = tools.find(
    (tool) => tool.skills.includes(name) || tool.skillPrefixes.some((prefix) => name.startsWith(prefix)),
  );
  return clash?.name;
}

function withTool(key: 'superpowers' | 'specKit', fields: ManifestData): ManifestData {
  const data = composeData();
  return { ...data, [key]: { ...(data[key] as ManifestData), ...fields } };
}

function loadWithCompose(compose: ManifestData): ManifestError {
  const files = kitFiles([plainManifest('base')], { 'modules/compose.json': JSON.stringify(compose) });
  try {
    loadCatalog(['base'], memoryReader(files));
  } catch (error) {
    if (error instanceof ManifestError) return error;
    throw error;
  }
  throw new Error('no ManifestError was thrown');
}

describe('modules/compose.json (#39, ADR-0008)', () => {
  it('records Superpowers v7.0.0, its exact install command and its 15 skill names, checked on 2026-10-19', () => {
    const { superpowers, checked } = catalog.compose;
    expect(checked).toBe('2026-10-19');
    expect(superpowers.knownGood).toEqual({ version: '7.0.0', released: '2026-10-10' });
    expect(superpowers.commands).toEqual([
      'claude plugin install superpowers@claude-plugins-official --scope project',
    ]);
    expect(superpowers.skills).toEqual(SUPERPOWERS_SKILLS);
  });

  it('records Spec Kit v1.2.1, its two commands, the --force warning and both skill prefixes', () => {
    const { specKit } = catalog.compose;
    expect(specKit.knownGood).toEqual({ version: '1.2.1', released: '2026-10-16' });
    expect(specKit.commands).toEqual([
      'uv tool install specify-cli==1.2.1',
      'specify init --here --integration claude',
    ]);
    expect(specKit.warning).toBe(
      'Commit first: specify init --here may replace files. Read specify init --help before --force.',
    );
    expect(specKit.skillPrefixes).toEqual(['speckit.', 'speckit-']);
  });

  it("pins every PyPI install it prints to the tool's known-good version, which ADR-0008 asks for", () => {
    const tools = [catalog.compose.superpowers, catalog.compose.specKit];
    const installs = tools.flatMap((tool) =>
      tool.commands
        .filter((line) => line.startsWith('uv tool install '))
        .map((line) => ({ line, pinned: line.endsWith(`==${tool.knownGood.version}`) })),
    );
    expect(installs.length).toBeGreaterThan(0);
    expect(installs.filter((install) => !install.pinned)).toEqual([]);
  });

  it('holds every kit skill apart from the Superpowers skill names and the speckit. and speckit- prefixes', () => {
    const names = kitSkillNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => clashOf(name, catalog.compose) !== undefined)).toEqual([]);
  });

  it.each([
    ['a Superpowers skill name', 'writing-plans', 'Superpowers'],
    ['the speckit. prefix of the commands Spec Kit documents', 'speckit.plan', 'Spec Kit'],
    ['the speckit- prefix Spec Kit v1.2.1 gives its Claude skills', 'speckit-plan', 'Spec Kit'],
  ])('would catch a kit skill with %s', (_name, skill, tool) => {
    expect(clashOf(skill, catalog.compose)).toBe(tool);
  });

  it.each<[string, ManifestData, string]>([
    ['no command', withTool('superpowers', { commands: [] }), 'superpowers.commands'],
    ['a command of two lines', withTool('specKit', { commands: ['a\nb'] }), 'specKit.commands[0]'],
    [
      'a version that is not major.minor.patch',
      withTool('specKit', { knownGood: { version: 'v1', released: '2026-10-16' } }),
      'specKit.knownGood.version',
    ],
    ['a tool the config cannot name', { ...composeData(), bmad: {} }, 'bmad'],
    ['a tool left out', { ...composeData(), specKit: undefined }, 'specKit'],
  ])('refuses a compose.json with %s, naming the file and the field', (_name, data, location) => {
    const error = loadWithCompose(data);
    expect(error.file).toBe('modules/compose.json');
    expect(error.location).toBe(location);
  });
});
