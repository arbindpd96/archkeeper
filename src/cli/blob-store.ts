import { gunzipSync, gzipSync } from 'node:zlib';
import { BRAND, type Brand } from '../core/brand.js';
import { LockError } from '../core/errors.js';
import { contentHash } from '../core/hash.js';

/** The most a blob may hold once decompressed: far above any kit file, so a gzip bomb fails instead (ADR-0014). */
export const MAX_BLOB_BYTES = 1024 * 1024;

const GZIP_OS_BYTE = 9;
const UNKNOWN_OS = 0xff;

/** The project folder of the committed base blobs. */
export function baseFolder(brand: Brand): string {
  return `${brand.stateDir}/base`;
}

/** Compresses bytes for a blob; the header names no OS, so every platform writes the same bytes. */
export function compressed(bytes: Buffer | string): Buffer {
  const gzip = gzipSync(bytes, { level: 9 });
  gzip[GZIP_OS_BYTE] = UNKNOWN_OS;
  return gzip;
}

function badBlob(name: string, brand: Brand, problem: string): LockError {
  return new LockError({
    file: `${baseFolder(brand)}/${name}`,
    location: '',
    problem: `is not a blob the kit wrote: ${problem}`,
    hint: `restore ${baseFolder(brand)}/ from git; only the kit writes blobs, each named by the sha256 of its content`,
  });
}

function decompressed(name: string, gzip: Buffer, brand: Brand): string {
  try {
    return gunzipSync(gzip, { maxOutputLength: MAX_BLOB_BYTES }).toString('utf8');
  } catch (error) {
    const tooLarge = error instanceof RangeError;
    throw badBlob(name, brand, tooLarge ? 'it decompresses to more than 1 MiB' : 'it is not valid gzip');
  }
}

/**
 * Decompresses a base blob and checks it against its name: the sha256 of its LF content (ADR-0014). Blobs are
 * committed, so they are untrusted: output is capped at {@link MAX_BLOB_BYTES}, and a blob that is not gzip, is
 * larger or does not hash to its name throws LockError.
 */
export function readBlob(name: string, gzip: Buffer, brand: Brand = BRAND): string {
  const content = decompressed(name, gzip, brand);
  if (contentHash(content) !== name) throw badBlob(name, brand, 'it does not hash to its name');
  return content;
}
