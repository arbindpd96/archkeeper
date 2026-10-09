import { gzipSync } from 'node:zlib';

export const pack = (text: string): Buffer => gzipSync(text);
