import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { ProjectView } from '../core/stack-profile.js';
import { compareText } from '../core/text.js';
import { confinedPath, lstatOrUndefined, readConfined } from './project-files.js';

const SOURCE = 'read to detect the stack';

function folderView(rootReal: string): ProjectView {
  return {
    list: (folder) => {
      if (folder === '') return readdirSync(rootReal).sort(compareText);
      if (lstatOrUndefined(path.join(rootReal, ...folder.split('/')))?.isDirectory() !== true) return [];
      return readdirSync(confinedPath(rootReal, folder, SOURCE)).sort(compareText);
    },
    read: (file) => {
      const state = readConfined(rootReal, file, SOURCE);
      return state?.kind === 'file' ? state.content : undefined;
    },
  };
}

// Undefined when the folder cannot be checked, say for lack of permission, which ends the lookup above the project:
// it only names the package manager, so it never fails detection.
function isRepositoryRoot(folder: string): boolean | undefined {
  try {
    return lstatOrUndefined(path.join(folder, '.git')) !== undefined;
  } catch {
    return undefined;
  }
}

// The folders from the project's parent up to the root of the git repository that holds it, so a workspace
// package uses its workspace's manager; none when the project is that root or in no repository at all.
function foldersAbove(rootReal: string): string[] {
  const folders: string[] = [];
  let folder = rootReal;
  for (let root = isRepositoryRoot(folder); root !== true; root = isRepositoryRoot(folder)) {
    const parent = path.dirname(folder);
    if (root === undefined || parent === folder) return [];
    folders.push(parent);
    folder = parent;
  }
  return folders;
}

/**
 * The project at `rootReal` as stack detection reads it (#25): every path is confined to the project (#23), a
 * symlink is never read or listed through, so a `.claude` linked to a dotfiles folder lists as empty, and a folder
 * lists its names in a fixed order. The folders above it, up to its repository's root, are read the same way.
 */
export function projectView(rootReal: string): ProjectView {
  return { ...folderView(rootReal), above: () => foldersAbove(rootReal).map(folderView) };
}
