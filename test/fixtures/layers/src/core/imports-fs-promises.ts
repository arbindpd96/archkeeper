import { readFile } from 'fs/promises';

export const read = (file: string): Promise<string> => readFile(file, 'utf8');
