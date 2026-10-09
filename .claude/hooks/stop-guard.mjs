import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { activeFeatures, changedFiles, git, projectDir, readInput, readState, respond, writeState } from './lib.mjs';

const CODE_PATH = /^(packages|modules|packs|plugin|scripts|\.claude\/hooks)\//;
const STATE_FILE = 'stop-guard.json';

/** Fingerprints the uncommitted working tree so an unchanged tree is not re-tested. */
function treeFingerprint(files) {
  const hash = createHash('sha1').update(git('diff', 'HEAD'));
  for (const file of files) {
    const absolute = path.join(projectDir, file);
    if (existsSync(absolute)) hash.update(file).update(readFileSync(absolute));
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

/** Builds the reason to keep working, or returns null when stopping is fine. */
function blockReason(input) {
  const changed = changedFiles();
  const codeChanged = changed.filter((file) => CODE_PATH.test(file));
  if (codeChanged.length === 0) return null;

  const state = readState(STATE_FILE, {});
  const fingerprint = treeFingerprint(changed);

  if (hasScript('check:quick') && state.greenFingerprint !== fingerprint) {
    const run = spawnSync('npm', ['run', '-s', 'check:quick'], {
      cwd: projectDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (run.status !== 0) {
      const output = `${run.stdout}\n${run.stderr}`.trim().slice(-3000);
      return `Code changed but \`npm run check:quick\` fails. Fix it before finishing:\n${output}`;
    }
    writeState(STATE_FILE, { ...state, greenFingerprint: fingerprint });
  }

  const memoryTouched = changed.some((file) => /^docs\/features\/[^/]+\/MEMORY\.md$/.test(file));
  const features = activeFeatures();
  if (!memoryTouched && features.length > 0 && state.remindedSession !== input.session_id) {
    writeState(STATE_FILE, { ...readState(STATE_FILE, {}), remindedSession: input.session_id });
    const files = features.map((f) => f.file).join(', ');
    return `Code changed but no feature memory was updated. Update "Done" and "Next step" in ${files}, or say why it is not needed.`;
  }
  return null;
}

const input = readInput();
if (!input.stop_hook_active) {
  const reason = blockReason(input);
  if (reason) respond({ decision: 'block', reason });
}
