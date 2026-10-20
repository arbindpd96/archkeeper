import { lstatSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../../../core/brand.js';
import { isEnvFileName } from '../env-files.js';
import { type Payload, stringField } from '../io.js';
import { isInside, realOrUndefined, slashed } from '../project.js';

/** The file an edit changed, as format-on-edit acts on it (#37). */
export interface EditedFile {
  /** Its absolute real path, which every tool gets, so a name such as `-x.ts` never reads as an option. */
  readonly file: string;
  /** Its path from the project folder, with forward slashes, as messages name it. */
  readonly relative: string;
  /** Its extension in lower case, dot included, which picks the tools that take it. */
  readonly extension: string;
}

const SKIPPED = ['node_modules', '.venv', '.git', BRAND.stateDir.toLowerCase()];

// Not project-tools' isRegularFile, which follows a link: format-on-edit never acts on a symlink.
function isRegularNonLink(file: string): boolean {
  try {
    return lstatSync(file).isFile();
  } catch {
    return false;
  }
}

// A secrets file such as .env goes to no tool: a failing check prints its lines back to Claude, past the Read deny
// rules and outside guard-bash, which asks before any command that names one (ADR-0015).
function isSkipped(relative: string): boolean {
  const parts = relative.toLowerCase().split(path.sep);
  return parts.some((part) => SKIPPED.includes(part)) || isEnvFileName(parts.at(-1) ?? '');
}

/**
 * The file an Edit, Write or MultiEdit changed, when format-on-edit may act on it (#37): `tool_input.file_path`
 * resolved against the payload's `cwd`, a regular file and no symlink, whose real path is inside the project and in
 * no `node_modules`, `.venv`, `.git` or state folder, and which is no secrets file such as `.env` or `.envrc`; a
 * template such as `.env.example` counts. Undefined for any other path.
 */
export function editedFile(payload: Payload, projectDir: string): EditedFile | undefined {
  const given = stringField(payload.tool_input, 'file_path');
  if (given === undefined || given === '') return undefined;
  const absolute = path.resolve(projectDir, stringField(payload, 'cwd') ?? '', given);
  const root = realOrUndefined(projectDir);
  const real = realOrUndefined(absolute);
  if (root === undefined || real === undefined || !isInside(root, real) || !isRegularNonLink(absolute)) {
    return undefined;
  }
  const relative = path.relative(root, real);
  if (isSkipped(relative)) return undefined;
  return { file: real, relative: slashed(relative), extension: path.extname(real).toLowerCase() };
}
