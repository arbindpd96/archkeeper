#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { exitWith, git, npm } from './lib.mjs';

const USAGE = 'Usage: node scripts/pack-release.mjs <destination>';
const NEXT_STEP = 'Run it from the release checkout.';
const DEV_ONLY_SCRIPTS = ['prepare'];

/** Lists how the checkout differs from the tagged commit beyond the dev-only scripts a release removes. */
function unexpectedChanges() {
  const status = git(['status', '--porcelain'], { action: 'list changed files', nextStep: NEXT_STEP });
  const others = status.split('\n').filter((line) => line !== '' && line !== ' M package.json');
  const committed = JSON.parse(
    git(['show', 'HEAD:package.json'], { action: 'read package.json', nextStep: NEXT_STEP }),
  );
  for (const name of DEV_ONLY_SCRIPTS) delete committed.scripts?.[name];
  const current = JSON.parse(readFileSync('package.json', 'utf8'));
  if (JSON.stringify(current) !== JSON.stringify(committed)) {
    others.push('package.json differs from the tagged commit by more than removing prepare');
  }
  return others;
}

const [destination, ...extra] = process.argv.slice(2);
if (destination === undefined || extra.length > 0) exitWith(USAGE, 2);
const changes = unexpectedChanges();
if (changes.length > 0) {
  exitWith(
    'pack-release: a release packs the tagged commit with only npm pkg delete scripts.prepare applied:\n' +
      changes.join('\n'),
    1,
  );
}
mkdirSync(destination, { recursive: true });
const args = ['pack', '--ignore-scripts', '--json', '--pack-destination', destination];
const [packed] = JSON.parse(npm(args, { nextStep: 'Run npm run build first.' }));
const outputs = `tarball=${packed.filename}\nintegrity=${packed.integrity}\nshasum=${packed.shasum}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
process.stdout.write(`pack-release: packed ${packed.filename} (shasum ${packed.shasum}).\n`);
