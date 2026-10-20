import { existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND } from '../src/core/brand.js';
import { edit, FORMAT, logged, messageOf, nodeTool, project } from './format-on-edit-helpers.js';
import { canSymlink, tempDir, writeFiles } from './helpers.js';

describe('the files format-on-edit acts on (#37)', () => {
  it.each([
    ['a file in node_modules', 'node_modules/x/a.ts'],
    ['a file in .venv', '.venv/a.ts'],
    ['a file in .git', '.git/a.ts'],
    ['a file in the state folder', `${BRAND.stateDir}/a.ts`],
    ['a file no recorded tool takes', 'notes.txt'],
    ['a missing file', 'missing.ts'],
  ])('does nothing for %s', (_name, file) => {
    const dir = project({ formatters: ['prettier'] });
    const prettier = nodeTool(dir, 'prettier', FORMAT);
    writeFiles(dir, { [file === 'missing.ts' ? 'other.ts' : file]: 'export {};\n' });
    expect(edit(dir, file)).toEqual({ kind: 'done' });
    expect(logged(prettier)).toEqual([]);
  });

  it('runs no command on a secrets file such as .envrc or .env.local, whose lines it could print back to Claude', () => {
    const dir = project({ commands: [['node', 'scripts/show.mjs']] });
    const show =
      "import fs from 'node:fs';\nconst file = process.argv.at(-1);\nfs.appendFileSync(new URL('show.log', import.meta.url), JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log(fs.readFileSync(file, 'utf8'));\nprocess.exit(1);\n";
    writeFiles(dir, {
      'scripts/show.mjs': show,
      '.envrc': 'export AWS_SECRET_ACCESS_KEY=x\n',
      '.env.local': 'TOKEN=x\n',
      'app/.env': 'TOKEN=x\n',
      '.env.example': 'TOKEN=\n',
    });
    const secrets = ['.envrc', '.env.local', 'app/.env'];
    expect(secrets.map((file) => edit(dir, file))).toEqual(secrets.map(() => ({ kind: 'done' })));
    const log = path.join(dir, 'scripts', 'show.log');
    expect(logged(log)).toEqual([]);
    expect(messageOf(edit(dir, '.env.example'))).toContain('node scripts/show.mjs:\n> TOKEN=');
    expect(logged(log)).toEqual([[path.join(dir, '.env.example')]]);
  });

  it.each(['AGENTS.md', 'CLAUDE.md', 'docs/guide.mdx'])(
    "runs no formatter on Markdown such as %s, so prettier never re-pads the kit's blocks there",
    (file) => {
      const dir = project({ formatters: ['prettier'], linters: ['eslint'] });
      const prettier = nodeTool(dir, 'prettier', FORMAT);
      writeFiles(dir, { [file]: '<!-- kit:begin rules -->\n| a | b |\n|---|---|\n<!-- kit:end rules -->\n' });
      expect(edit(dir, file)).toEqual({ kind: 'done' });
      expect(logged(prettier)).toEqual([]);
    },
  );

  it('does nothing for a file outside the project', () => {
    const dir = project({ formatters: ['prettier'] });
    const prettier = nodeTool(dir, 'prettier', FORMAT);
    const outside = path.join(tempDir(), 'a.ts');
    writeFiles(path.dirname(outside), { 'a.ts': 'export {};\n' });
    expect(edit(dir, outside)).toEqual({ kind: 'done' });
    expect(edit(dir, '../a.ts')).toEqual({ kind: 'done' });
    expect(logged(prettier)).toEqual([]);
  });

  it.skipIf(!canSymlink())('does nothing for a symlink, even to a file inside the project', () => {
    const dir = project({ formatters: ['prettier'] });
    const prettier = nodeTool(dir, 'prettier', FORMAT);
    writeFiles(dir, { 'src/a.ts': 'export {};\n' });
    symlinkSync(path.join(dir, 'src', 'a.ts'), path.join(dir, 'src', 'link.ts'));
    expect(edit(dir, 'src/link.ts')).toEqual({ kind: 'done' });
    expect(logged(prettier)).toEqual([]);
  });

  it.skipIf(!canSymlink())(
    'does nothing for a regular file reached through a folder link out of the project, into node_modules or .git',
    () => {
      const dir = project({ formatters: ['prettier'] });
      const prettier = nodeTool(dir, 'prettier', FORMAT);
      const outside = tempDir();
      writeFiles(outside, { 'a.ts': 'export {};\n' });
      writeFiles(dir, {
        'src/own.ts': 'export {};\n',
        'node_modules/x/a.ts': 'export {};\n',
        '.git/x/a.ts': 'export {};\n',
      });
      const links = {
        out: outside,
        deps: path.join(dir, 'node_modules', 'x'),
        vcs: path.join(dir, '.git', 'x'),
      };
      for (const [name, target] of Object.entries(links)) {
        symlinkSync(target, path.join(dir, 'src', name), 'dir');
      }
      const edits = Object.keys(links).map((name) => edit(dir, `src/${name}/a.ts`));
      expect(edits).toEqual([{ kind: 'done' }, { kind: 'done' }, { kind: 'done' }]);
      expect(logged(prettier)).toEqual([]);
      expect(edit(dir, 'src/own.ts')).toEqual({ kind: 'done' });
      expect(logged(prettier).map((args) => args.at(-1))).toEqual([path.join(dir, 'src', 'own.ts')]);
    },
  );

  it('gives a file named like a shell command to the tool as one argument, its exact name', () => {
    const dir = project({ formatters: ['prettier'] });
    const prettier = nodeTool(dir, 'prettier', FORMAT);
    writeFiles(dir, { 'src/x.ts': 'export {};\n', 'src/a;rm -rf x.ts': 'export {};\n' });
    expect(edit(dir, 'src/a;rm -rf x.ts')).toEqual({ kind: 'done' });
    expect(existsSync(path.join(dir, 'src', 'x.ts'))).toBe(true);
    expect(logged(prettier)[0]?.at(-1)).toBe(path.join(dir, 'src', 'a;rm -rf x.ts'));
  });
});
