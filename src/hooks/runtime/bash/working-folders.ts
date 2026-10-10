import type { Command } from '../shell/commands.js';
import { type PathContext, resolveFolder } from './dangerous-paths.js';

const MAX_FOLDERS = 16;
const CHANGES_FOLDER: ReadonlySet<string> = new Set(['cd', 'chdir', 'pushd']);
const OPTION = /^-[A-Za-z@]+$/;
const STACK_ROTATION = /^[+-]\d+$/;

type FolderChange = { readonly to: string } | 'none' | 'unknown';

// `pushd -n`, a bare `pushd` and a stack rotation (`pushd +1`) only reorder folders this line already reached, and
// popd is left out for the same reason; `cd -` returns to a folder an earlier call chose.
function folderChange({ program, args }: Command): FolderChange {
  const optionCount = args.findIndex((arg) => !OPTION.test(arg));
  const options = optionCount === -1 ? args : args.slice(0, optionCount);
  const operands = args.slice(options.length);
  const target = operands[0] === '--' ? operands[1] : operands[0];
  const keepsFolder = options.some((option) => option.includes('n')) || target === undefined;
  if (program === 'pushd' && (keepsFolder || STACK_ROTATION.test(target))) return 'none';
  if (target === undefined) return { to: '~' };
  return target === '-' ? 'unknown' : { to: target };
}

// Every earlier folder stays possible, since a `cd` may fail or sit in a subshell.
function nextFolders(
  command: Command,
  folders: readonly string[] | null,
  paths: PathContext,
): readonly string[] | null {
  if (folders === null || command.definesFunction) return folders;
  if (command.dynamicProgram) return null;
  if (!CHANGES_FOLDER.has(command.program)) return folders;
  const change = folderChange(command);
  if (change === 'none' || change === 'unknown') return change === 'none' ? folders : null;
  const moved = folders.map((folder) => resolveFolder(change.to, folder, paths));
  if (moved.includes(null)) return null;
  const reachable = [...new Set([...folders, ...moved.filter((folder) => folder !== null)])];
  return reachable.length > MAX_FOLDERS ? null : reachable;
}

/** The folders each command may run in, and the folders the whole line may end in. */
export interface WorkingFolders {
  readonly at: (command: Command) => PathContext;
  readonly last: PathContext;
}

/** Follows `cd`, `chdir` and `pushd` through a command line: the folders each command may run in. */
export function workingFolders(commands: readonly Command[], paths: PathContext): WorkingFolders {
  const contexts = new Map<Command, PathContext>();
  // A literal target adds the folder it reaches; one an expansion decides, or a program named by an expansion,
  // makes the folder unknown (null), after which a relative recursive delete asks.
  let folders = paths.cwds;
  for (const command of commands) {
    contexts.set(command, folders === paths.cwds ? paths : { ...paths, cwds: folders });
    folders = nextFolders(command, folders, paths);
  }
  return {
    at: (command) => contexts.get(command) ?? paths,
    last: folders === paths.cwds ? paths : { ...paths, cwds: folders },
  };
}
