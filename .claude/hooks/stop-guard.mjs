import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  activeFeatures,
  changedFiles,
  git,
  isProjectFile,
  projectDir,
  readInput,
  readState,
  respond,
  writeState,
} from './lib.mjs';

const CODE_PATH = /^(src|test|packages|modules|packs|plugin|scripts|\.claude\/hooks)\//;
const MEMORY_PATH = /^docs\/features\/[^/]+\/MEMORY\.md$/;
const STATE_FILE = 'stop-guard.json';
const NODE_DIR = path.dirname(process.execPath);
const NPM_CLI_CANDIDATES = [
  path.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.join(NODE_DIR, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
];

/** Fingerprints the uncommitted working tree so an unchanged tree is not re-tested. */
function treeFingerprint(files) {
  const hash = createHash('sha1').update(git('diff', 'HEAD'));
  for (const file of files) {
    const absolute = path.join(projectDir, file);
    if (isProjectFile(absolute)) hash.update(file).update(readFileSync(absolute));
  }
  return hash.digest('hex');
}

/** Returns true when the root package.json defines the given npm script and dependencies are installed. */
function hasScript(name) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts?.[name]) && existsSync(path.join(projectDir, 'node_modules'));
  } catch {
    return false;
  }
}

/** Runs `npm run check:quick` with no shell and with pre/post lifecycle scripts disabled. */
function runQuickCheck() {
  const npmCli = NPM_CLI_CANDIDATES.find((candidate) => existsSync(candidate));
  const [command, prefix] = npmCli ? [process.execPath, [npmCli]] : ['npm', []];
  return spawnSync(command, [...prefix, 'run', '--ignore-scripts', '-s', 'check:quick'], {
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 280_000,
  });
}

/** Returns a block reason when changed code fails `check:quick`; remembers green trees. */
function failingCheckReason(changed, state) {
  const fingerprint = treeFingerprint(changed);
  if (!hasScript('check:quick') || state.greenFingerprint === fingerprint) return null;
  const run = runQuickCheck();
  if (run.error) return null;
  if (run.status !== 0) {
    const output = `${run.stdout}\n${run.stderr}`.trim().slice(-3000);
    return `Code changed but \`npm run check:quick\` fails. Fix it before finishing:\n${output}`;
  }
  writeState(STATE_FILE, { ...state, greenFingerprint: fingerprint });
  return null;
}

/** Returns a one-per-session reminder to update feature memory when code changed but memory did not. */
function memoryReminder(changed, sessionId) {
  const state = readState(STATE_FILE, {});
  const features = activeFeatures();
  if (changed.some((file) => MEMORY_PATH.test(file)) || features.length === 0) return null;
  if (state.remindedSession === sessionId) return null;
  writeState(STATE_FILE, { ...state, remindedSession: sessionId });
  const files = features.map((feature) => feature.file).join(', ');
  return `Code changed but no feature memory was updated. Update "Done" and "Next step" in ${files}, or say why it is not needed.`;
}

/** Builds the reason to keep working, or returns null when stopping is fine. */
function blockReason(input) {
  const changed = changedFiles();
  if (!changed.some((file) => CODE_PATH.test(file))) return null;
  return failingCheckReason(changed, readState(STATE_FILE, {})) ?? memoryReminder(changed, input.session_id);
}

const input = readInput();
if (!input.stop_hook_active) {
  const reason = blockReason(input);
  if (reason) respond({ decision: 'block', reason });
}
