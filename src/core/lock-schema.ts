import * as z from 'zod/mini';
import { HASH } from './hash.js';
import { JSON_KEY } from './json-keys.js';
import { pathSafetyProblem } from './path-safety.js';
import { described, kebabId, refusing } from './schema-parts.js';
import { SEMVER } from './version.js';

/** The lock format this kit writes and reads (ADR-0014). */
export const LOCKFILE_VERSION = 1;

const hash = z.string().check(z.regex(HASH, { error: 'write a sha256 as 64 lowercase hex digits' }));
const base = described(
  z.nullable(hash),
  'The hash of the content the kit last wrote, or null where it never wrote.',
);
const pending = described(
  z.optional(hash),
  'The hash of the kit content waiting in a sidecar for the user to review.',
);
const lockPath = z.string().check(
  refusing((value) => {
    const problem = pathSafetyProblem(value);
    if (problem === undefined) return undefined;
    return { problem, hint: 'restore lock.json from git: the kit never records such a path' };
  }),
);
const jsonKey = z
  .string()
  .check(z.regex(JSON_KEY, { error: 'name $schema, a permission rule, a hook or an MCP server' }));

const fileEntry = z.strictObject({
  module: kebabId,
  strategy: z.enum(['owned', 'create-only']),
  base,
  pending,
});
const blockEntry = z.strictObject({ base, pending });
const removal = z.union([
  z.strictObject({ path: lockPath }),
  z.strictObject({ path: lockPath, blockId: kebabId }),
  z.strictObject({ path: lockPath, key: jsonKey }),
]);

/** The contract of `<state dir>/lock.json`, which only the kit writes (ADR-0014); paths are project-relative. */
export const lockSchema = z
  .strictObject({
    lockfileVersion: z.literal(LOCKFILE_VERSION, {
      error: `set lockfileVersion to ${String(LOCKFILE_VERSION)}`,
    }),
    kit: z.strictObject({
      name: z.string().check(z.minLength(1)),
      version: z.string().check(z.regex(SEMVER, { error: 'write a semantic version such as 0.1.0' })),
    }),
    modules: described(z.array(kebabId), 'Module ids in install order.'),
    files: described(z.record(lockPath, fileEntry), 'Owned and create-only files by path.'),
    blocks: described(
      z.record(lockPath, z.record(kebabId, blockEntry)),
      'Managed blocks by file and block id.',
    ),
    json: described(
      z.record(lockPath, z.record(jsonKey, hash)),
      'Kit-owned JSON entries by file and owned key, each with the hash of the entry the kit wrote.',
    ),
    removed: described(
      z.array(removal),
      'Kit files, blocks and JSON entries the user deleted; the kit never recreates them.',
    ),
  })
  .register(z.globalRegistry, {
    title: 'Lock',
    description: 'Machine state written only by the kit (ADR-0014). Every hash is a sha256 of LF content.',
  });
