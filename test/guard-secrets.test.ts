import { copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, hookDecision, permissionDecision, tempDir } from './helpers.js';

const decision = (toolInput: unknown) => hookDecision('guard-secrets.mjs', toolInput);

const write = (content: string) => ({ file_path: 'src/config.ts', content });

describe('guard-secrets patterns', () => {
  it.each([
    ['AWS temporary key', `ASIA${'Q'.repeat(16)}`],
    ['AWS secret line', `aws_secret_access_key = ${'a'.repeat(40)}`],
    ['GitHub token followed by an underscore', `ghp_${'a'.repeat(36)}_x`],
    ['Slack app token', `xapp-1-${'A'.repeat(20)}`],
    [
      'Slack webhook',
      `https://hooks.slack.com/services/${'T'.repeat(9)}/${'B'.repeat(11)}/${'x'.repeat(24)}`,
    ],
    ['Stripe webhook secret', `whsec_${'a'.repeat(32)}`],
    ['PGP private key block', ['-----BEGIN PGP PRIVATE', 'KEY BLOCK-----'].join(' ')],
    ['JWT', `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`],
    ['credentialed database URL', 'postgres://admin:s3cr3tValue@db.internal:5432/app'],
    ['npmrc auth token', `//registry.npmjs.org/:_authToken=${'n'.repeat(36)}`],
  ])('denies a %s', (_name, secret) => {
    expect(decision(write(`const value = '${secret}';`))).toBe('deny');
  });

  it.each([
    ['env-var reference in a URL', 'https://user:${TOKEN}@github.com/o/r.git'],
    ['placeholder password', 'postgres://user:password@localhost/db'],
    ['npmrc token from env', '//registry.npmjs.org/:_authToken=${NPM_TOKEN}'],
  ])('allows a %s', (_name, text) => {
    expect(decision(write(text))).toBe('allow');
  });
});

describe('guard-secrets env files and robustness', () => {
  it.each(['/p/.ENV', '/p/.envrc', '/p/packages/api/.env.production'])('asks before editing %s', (file) => {
    expect(decision({ file_path: file, content: 'A=1' })).toBe('ask');
  });

  it('allows editing .env.example in any case', () => {
    expect(decision({ file_path: '/p/.ENV.EXAMPLE', content: 'A=' })).toBe('allow');
  });

  it('does not crash on malformed multi-edit payloads', () => {
    expect(decision({ file_path: 'a.ts', edits: [null, { new_string: 'ok' }] })).toBe('allow');
    expect(decision({ file_path: 'a.ts', edits: 'not-an-array' })).toBe('allow');
  });
});

describe('guard-secrets fail-closed loading', () => {
  it('asks instead of allowing when its helper module cannot be loaded', () => {
    const isolated = path.join(tempDir(), 'guard-secrets.mjs');
    copyFileSync(path.join(REPO_ROOT, '.claude', 'hooks', 'guard-secrets.mjs'), isolated);
    const run = spawnSync(process.execPath, [isolated], {
      input: JSON.stringify({ tool_input: { file_path: 'a.ts', content: 'x' } }),
      encoding: 'utf8',
    });
    expect(permissionDecision(run.stdout)).toBe('ask');
  });

  it.each(['/p/.env~', '/p/.env.backup'])('asks before editing %s', (file) => {
    expect(decision({ file_path: file, content: 'A=1' })).toBe('ask');
  });
});
