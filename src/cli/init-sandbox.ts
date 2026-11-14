import { realpathSync } from 'node:fs';
import path from 'node:path';
import { parseJson } from '../core/json.js';
import { SETTINGS_FILE } from '../core/manifest-schema.js';
import { LOCAL_SETTINGS_FILE } from '../core/targets.js';
import { isRecord } from '../core/text.js';
import { readFileBytes } from './project-files.js';

// What a settings file says of the sandbox: on, off, or nothing. A file that cannot be read or parsed says nothing
// here, since Claude Code reports it itself and this only decides whether init warns.
function sandboxSetting(file: string): boolean | undefined {
  let text: string | undefined;
  try {
    text = readFileBytes(realpathSync.native(file))?.toString('utf8');
  } catch {
    return undefined;
  }
  const parsed = parseJson(text ?? '');
  const sandbox = parsed.ok && isRecord(parsed.value) ? parsed.value.sandbox : undefined;
  const enabled = isRecord(sandbox) ? sandbox.enabled : undefined;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

/**
 * The settings file that turns Claude Code's sandbox on for a project, as init names it, or undefined when none does:
 * of `.claude/settings.local.json`, `.claude/settings.json` and `~/.claude/settings.json`, the first that sets
 * `sandbox.enabled` decides, in Claude Code's order of precedence. Managed settings and `--settings` are not read.
 */
export function sandboxSettingsFile(rootReal: string, home: string): string | undefined {
  const files: readonly (readonly [shown: string, file: string])[] = [
    [LOCAL_SETTINGS_FILE, path.join(rootReal, LOCAL_SETTINGS_FILE)],
    [SETTINGS_FILE, path.join(rootReal, SETTINGS_FILE)],
    [`~/${SETTINGS_FILE}`, path.join(home, SETTINGS_FILE)],
  ];
  for (const [shown, file] of files) {
    const enabled = sandboxSetting(file);
    if (enabled !== undefined) return enabled ? shown : undefined;
  }
  return undefined;
}
