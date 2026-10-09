import { exit } from 'process';

export const stop = (): never => exit(1);
