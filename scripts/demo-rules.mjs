import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

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

/** Returns each line's heading match, or null for plain lines and every line inside a fenced code block. */
function headings(lines) {
  let fence;
  return lines.map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
      fence = fence === undefined ? marker : undefined;
      return null;
    }
    return fence === undefined ? HEADING.exec(line) : null;
  });
}

/** Returns the lines of the README section under the heading `title`, or undefined when there is none. */
function sectionOf(readme, title) {
  const lines = readme.split('\n');
  const matches = headings(lines);
  const start = matches.findIndex((heading) => heading?.[2] === title);
  if (start === -1) return undefined;
  const level = matches[start][1].length;
  const end = matches.findIndex(
    (heading, index) => index > start && heading !== null && heading[1].length <= level,
  );
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** Lists what a declared demo is missing: its tape, its GIF, or a README section that shows the GIF. */
function demoProblems(subject, demo, options) {
  const where = `${subject} demo "${demo.tape}"`;
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

/** Holds one module or command to the rule: exactly one of `demo: {tape, section}` or `internal: true`. */
function declarationProblems(kind, name, { demo, internal }, options) {
  const subject = `${kind} ${name}`;
  if (demo === undefined && internal !== true) {
    return [`${subject} declares neither demo nor internal: true; a user-facing ${kind} needs a demo.`];
  }
  if (demo !== undefined && internal !== undefined) return [`${subject} declares both demo and internal.`];
  if (demo === undefined) return [];
  if (typeof demo.tape !== 'string' || typeof demo.section !== 'string') {
    return [`${subject} demo needs a tape and a README section, as {"tape": "...", "section": "..."}.`];
  }
  return demoProblems(subject, demo, options);
}

/**
 * Applies the #18 rule to every module: declare exactly one of `demo: {tape, section}` or `internal: true`,
 * and a demo needs its tape, its committed GIF and a README section that shows it.
 */
export function moduleDemoProblems(options) {
  return readManifests(options.modules).flatMap(({ id, file, manifest, error }) => {
    if (error !== undefined) return [`${file} is not valid JSON (${error}).`];
    return declarationProblems('module', id, manifest, options);
  });
}

/** Applies the same rule to every command in the CLI's command registry (#26), which `commands` lists. */
export function commandDemoProblems(commands, options) {
  if (!Array.isArray(commands)) {
    return [`${options.commands} exports no COMMANDS list; the CLI registry must list every command.`];
  }
  return commands.flatMap((command) => declarationProblems('command', command.name, command, options));
}
