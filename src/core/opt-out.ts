import type { Brand } from './brand.js';
import { type ModuleManifest, SETTINGS_FILE } from './manifest-schema.js';
import type { ModuleOptions } from './options.js';
import type { Ownable } from './plan-types.js';
import { hookKey, hookScriptPath, PERMISSION_LISTS, permissionKey } from './render-json.js';

/** The module option that lists the permission rules and hooks a project removes on purpose (ADR-0014). */
export const OPT_OUT = 'optOut';

type Hook = ModuleManifest['hooks'][number];

/** What one optOut entry leaves out: the settings keys and the hook scripts the kit would otherwise own. */
export interface OptedOut {
  readonly name: string;
  readonly keys: readonly string[];
  readonly scripts: readonly string[];
}

/** The name optOut gives a hook: its bundle's name, such as `guard-bash` for `dist/hooks/guard-bash.mjs`. */
export function hookName(hook: Hook): string {
  return hook.script.slice(hook.script.lastIndexOf('/') + 1).replace(/\.mjs$/, '');
}

function optedOut(options: ModuleOptions): ReadonlySet<string> {
  const value = options[OPT_OUT];
  return new Set(Array.isArray(value) ? value.map((entry) => entry.trim()) : []);
}

/** Every name a module's optOut may list: its permission rules and its hooks' bundle names. */
export function optOutNames(manifest: ModuleManifest): string[] {
  const rules = PERMISSION_LISTS.flatMap((list) => manifest.permissions[list] ?? []);
  return [...new Set([...rules, ...manifest.hooks.map(hookName)])];
}

/** The entries of a module's optOut that name none of its permission rules or hooks, such as a misspelled rule. */
export function unknownOptOuts(manifest: ModuleManifest, options: ModuleOptions): string[] {
  const names = new Set(optOutNames(manifest));
  return [...optedOut(options)].filter((entry) => !names.has(entry));
}

/** A manifest without the permission rules and hooks its optOut option lists, so the kit never writes them. */
export function withoutOptedOut(manifest: ModuleManifest, options: ModuleOptions): ModuleManifest {
  const out = optedOut(options);
  if (out.size === 0) return manifest;
  const permissions = { ...manifest.permissions };
  for (const list of PERMISSION_LISTS) {
    const rules = manifest.permissions[list];
    if (rules !== undefined) permissions[list] = rules.filter((rule) => !out.has(rule));
  }
  return { ...manifest, permissions, hooks: manifest.hooks.filter((hook) => !out.has(hookName(hook))) };
}

/** Each known entry of a module's optOut with the settings keys and hook scripts it leaves out. */
export function optedOutEntries(manifest: ModuleManifest, options: ModuleOptions, brand: Brand): OptedOut[] {
  const kept = withoutOptedOut(manifest, options);
  const keptScripts = new Set(kept.hooks.map((hook) => hook.script));
  return [...optedOut(options)].flatMap((name) => {
    const rules = PERMISSION_LISTS.filter((list) => manifest.permissions[list]?.includes(name) === true);
    const hooks = manifest.hooks.filter((hook) => hookName(hook) === name);
    if (rules.length === 0 && hooks.length === 0) return [];
    const keys = [
      ...rules.map((list) => permissionKey(list, name)),
      ...hooks.map((hook) => hookKey(hook.event, hookScriptPath(hook.script, brand))),
    ];
    const scripts = hooks
      .filter((hook) => !keptScripts.has(hook.script))
      .map((hook) => hookScriptPath(hook.script, brand));
    return [{ name, keys, scripts: [...new Set(scripts)] }];
  });
}

/**
 * The paths and settings entries the current kit could own but optOut leaves out, so a plan removes the ones the
 * kit wrote and the user left unchanged (ADR-0014: the kit removes only what the current manifests could own).
 */
export function optOutOwnable(entries: readonly OptedOut[]): Ownable {
  const keys = new Set(entries.flatMap((entry) => entry.keys));
  const scripts = new Set(entries.flatMap((entry) => entry.scripts));
  return (path, entry) =>
    entry === undefined ? scripts.has(path) : path === SETTINGS_FILE && keys.has(entry);
}
