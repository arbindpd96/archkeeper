import { exit } from 'node:process';

export const stop = (): never => exit(1);
