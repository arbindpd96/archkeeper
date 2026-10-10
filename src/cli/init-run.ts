import path from 'node:path';
import type { Brand } from '../core/brand.js';
import { type KitId, lockFilePath } from '../core/lock.js';
import type { Plan } from '../core/plan.js';
import type { RenderTree } from '../core/render.js';
import type { Stack } from '../core/schema-parts.js';
import type { StackProfile } from '../core/stack-profile.js';
import { toLf } from '../core/text.js';
import { baseFolder } from './blob-store.js';
import type { Session } from './context.js';
import type { Asking } from './init-answers.js';
import type { ExistingConfig, NextConfig } from './init-config.js';
import { lstatOrUndefined, readConfined } from './project-files.js';

/** The flags of `init` itself (#27); the global ones come from the session. */
export interface InitFlags {
  readonly preset?: string;
  readonly modules?: string;
  readonly stack?: string;
  readonly dryRun?: boolean;
}

/** One run of `init`: the session, its flags, the project folder, the kit and how it may ask. */
export interface InitRun {
  readonly session: Session;
  readonly flags: InitFlags;
  readonly root: string;
  readonly rootReal: string;
  readonly brand: Brand;
  readonly kit: KitId;
  readonly asking: Asking;
  readonly json: boolean;
}

/** What init planned: the detected stack, the config before and after, the modules, the tree and the plan. */
export interface Planned {
  readonly profile: StackProfile;
  readonly existing: ExistingConfig | undefined;
  readonly next: NextConfig;
  readonly stack: readonly Stack[];
  readonly modules: readonly string[];
  readonly tree: RenderTree;
  /** The install plan, the config included when it changes. */
  readonly plan: Plan;
  /** Whether applying the plan writes anything: a file, the config, the lock or a base blob. */
  readonly writes: boolean;
}

/** A project file's text, or undefined when it is absent or not a regular text file. */
export function textAt(rootReal: string, file: string): string | undefined {
  const state = readConfined(rootReal, file, 'read for the plan');
  return state?.kind === 'file' ? state.content : undefined;
}

/**
 * Whether applying `plan` writes anything, as the apply decides it: a file or the config, the lock when its text
 * changes, as after a kit upgrade, or a base blob that is missing. Any write needs a yes (#27).
 */
export function writesAnything(rootReal: string, plan: Plan, brand: Brand): boolean {
  if (plan.writes.size > 0) return true;
  const lock = textAt(rootReal, lockFilePath(brand));
  if (lock === undefined || toLf(lock) !== plan.lockText) return true;
  const blobs = path.join(rootReal, ...baseFolder(brand).split('/'));
  return [...plan.blobs.keys()].some((hash) => lstatOrUndefined(path.join(blobs, hash)) === undefined);
}
