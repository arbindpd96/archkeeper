import { execFileSync } from 'node:child_process';

export const branch = (): string => execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
