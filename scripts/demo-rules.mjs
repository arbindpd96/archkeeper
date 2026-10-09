import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Reads the module manifests under `modules`, each as `{ id, file, manifest }` or `{ id, file, error }`. */
function readManifests(modules) {
  if (!existsSync(modules)) return [];
  return readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(modules, entry.name, 'module.json')))
    .map((entry) => entry.name)
    .sort()
    .map((id) => {
      const file = path.join(modules, id, 'module.json');
      try {
        return { id, file, manifest: JSON.parse(readFileSync(file, 'utf8')) };
      } catch (error) {
        return { id, file, error: error.message };
      }
    });
}

/** Returns the lines of the README section under the heading `title`, or undefined when there is none. */
function sectionOf(readme, title) {
  const lines = readme.split('\n');
  const start = lines.findIndex((line) => HEADING.exec(line)?.[2] === title);
  if (start === -1) return undefined;
  const level = HEADING.exec(lines[start])[1].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const heading = HEADING.exec(line);
    return heading !== null && heading[1].length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Lists what a declared demo is missing: its tape, its GIF, or a README section that shows the GIF. */
function demoProblems({ id, demo }, options) {
  const where = `module ${id} demo "${demo.tape}"`;
  const problems = [];
  if (!existsSync(path.join(options.tapes, `${demo.tape}.tape`))) {
    problems.push(`${where} has no tape at ${path.join(options.tapes, `${demo.tape}.tape`)}.`);
  }
  if (!existsSync(path.join(options.gifs, `${demo.tape}.gif`))) {
    problems.push(
      `${where} has no GIF at ${path.join(options.gifs, `${demo.tape}.gif`)}; commit the rendered GIF.`,
    );
  }
  const readme = existsSync(options.readme) ? readFileSync(options.readme, 'utf8') : '';
  const section = sectionOf(readme, demo.section);
  if (section === undefined) {
    problems.push(`${where} needs a "${demo.section}" heading in ${options.readme}.`);
  } else if (!section.includes(`${demo.tape}.gif`)) {
    problems.push(
      `${where}: the "${demo.section}" section of ${options.readme} does not show ${demo.tape}.gif.`,
    );
  }
  return problems;
}

/**
 * Applies the #18 rule to every module: declare exactly one of `demo: {tape, section}` or `internal: true`,
 * and a demo needs its tape, its committed GIF and a README section that shows it.
 */
export function moduleDemoProblems(options) {
  return readManifests(options.modules).flatMap(({ id, file, manifest, error }) => {
    if (error !== undefined) return [`${file} is not valid JSON (${error}).`];
    const { demo, internal } = manifest;
    if (demo === undefined && internal !== true) {
      return [`module ${id} declares neither demo nor internal: true; a user-facing module needs a demo.`];
    }
    if (demo !== undefined && internal !== undefined) {
      return [`module ${id} declares both demo and internal.`];
    }
    if (demo === undefined) return [];
    if (typeof demo.tape !== 'string' || typeof demo.section !== 'string') {
      return [`module ${id} demo needs a tape and a README section, as {"tape": "...", "section": "..."}.`];
    }
    return demoProblems({ id, demo }, options);
  });
}
