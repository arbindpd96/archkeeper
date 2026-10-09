/** Likely secrets by kind, built at run time so the repository holds no literal one. */
export const SECRET_SAMPLES: readonly (readonly [string, string])[] = [
  ['AWS temporary key', `ASIA${'Q'.repeat(16)}`],
  ['AWS secret line', `aws_secret_access_key = ${'a'.repeat(40)}`],
  ['GitHub token followed by an underscore', `ghp_${'a'.repeat(36)}_x`],
  ['Slack app token', `xapp-1-${'A'.repeat(20)}`],
  ['Slack webhook', `https://hooks.slack.com/services/${'T'.repeat(9)}/${'B'.repeat(11)}/${'x'.repeat(24)}`],
  ['Stripe webhook secret', `whsec_${'a'.repeat(32)}`],
  ['PGP private key block', ['-----BEGIN PGP PRIVATE', 'KEY BLOCK-----'].join(' ')],
  ['JWT', `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(20)}`],
  ['credentialed database URL', 'postgres://admin:s3cr3tValue@db.internal:5432/app'],
  ['npmrc auth token', `//registry.npmjs.org/:_authToken=${'n'.repeat(36)}`],
  ['AWS access key', `AKIA${'Q'.repeat(16)}`],
  ['GitHub fine-grained token', `github_pat_${'a'.repeat(60)}`],
  ['Anthropic API key', `sk-ant-${'a'.repeat(24)}`],
  ['OpenAI API key', `sk-${'a'.repeat(40)}`],
  ['OpenAI project key', `sk-proj-${'a'.repeat(40)}`],
  ['Slack bot token', `xoxb-${'1'.repeat(12)}`],
  ['Stripe live key', `sk_live_${'a'.repeat(24)}`],
  ['Stripe restricted key', `rk_live_${'a'.repeat(24)}`],
  ['Google API key', `AIza${'a'.repeat(35)}`],
  ['npm token', `npm_${'a'.repeat(36)}`],
  ['RSA private key', ['-----BEGIN RSA PRIVATE', 'KEY-----'].join(' ')],
];

/** Text that only looks like a secret, such as an environment variable reference or a placeholder password. */
export const LOOKALIKE_SAMPLES: readonly (readonly [string, string])[] = [
  ['env-var reference in a URL', 'https://user:${TOKEN}@github.com/o/r.git'],
  ['placeholder password', 'postgres://user:password@localhost/db'],
  ['npmrc token from env', '//registry.npmjs.org/:_authToken=${NPM_TOKEN}'],
];
