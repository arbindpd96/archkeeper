import { BRAND, type Brand } from './brand.js';
import { RenderError } from './errors.js';
import { type KitModule, templatePath } from './loader.js';
import { GITIGNORE_FILE, MCP_FILE, type ModuleManifest } from './manifest-schema.js';
import { optionDefaults, type ResolvedOptions } from './options.js';
import { relativePathProblem } from './paths.js';
import { hookScriptPath, type JsonPart, mcpPart, settingsPart, toJson } from './render-json.js';
import { collectEntries, type Draft, type RenderTree } from './render-tree.js';
import type { Stack } from './schema-parts.js';
import { reservedTarget } from './targets.js';
import { brandScope, renderTemplate, type TemplateScope } from './template.js';
import { asLfText } from './text.js';
import { whenMismatch } from './when.js';

/** What a render depends on besides the modules and the brand: the stack, option values and template values. */
export interface RenderContext {
  readonly stack: readonly Stack[];
  readonly options?: ResolvedOptions;
  /** Values templates read next to `brand.*`, such as detected commands; `brand` is always the brand's. */
  readonly values?: TemplateScope;
}

export type { RenderedEntry, RenderTree } from './render-tree.js';

type ManifestFile = ModuleManifest['files'][number];

interface ModuleRender {
  readonly kit: KitModule;
  readonly context: RenderContext;
  readonly scope: TemplateScope;
  readonly brand: Brand;
}

function source(kit: KitModule, path: string): string {
  const text = kit.sources.get(path);
  if (text === undefined) {
    throw new RenderError({
      file: kit.file,
      location: '',
      problem: `has no loaded source ${path}`,
      hint: 'load it with loadModule',
    });
  }
  return text;
}

function renderedPath(job: ModuleRender, file: ManifestFile, index: number): string {
  const location = `files[${String(index)}].to`;
  const path = renderTemplate(file.to, job.scope, `${job.kit.file} ${location}`);
  const problem = relativePathProblem(path);
  if (problem !== undefined) {
    throw new RenderError({
      file: job.kit.file,
      location,
      problem: `renders to "${path}", which ${problem}`,
      hint: 'fix the path or the brand value it uses',
    });
  }
  const reserved = file.strategy === 'json' ? undefined : reservedTarget(path, job.brand);
  if (reserved !== undefined) {
    throw new RenderError({
      file: job.kit.file,
      location,
      problem: `renders to "${path}", which ${reserved.problem}`,
      hint: reserved.hint,
    });
  }
  return path;
}

function template(job: ModuleRender, relative: string): string {
  const file = templatePath(job.kit.manifest.id, relative);
  return asLfText(renderTemplate(source(job.kit, file), job.scope, file));
}

function blockDrafts(job: ModuleRender, file: ManifestFile, path: string): Draft[] {
  const { manifest } = job.kit;
  const drafts: Draft[] = manifest.blocks
    .filter((block) => block.file === file.to)
    .map((block) => ({
      path,
      strategy: 'blocks',
      module: manifest.id,
      blockId: block.id,
      content: template(job, block.template),
    }));
  if (file.to === GITIGNORE_FILE && manifest.gitignore.length > 0) {
    const lines = manifest.gitignore.map((line) =>
      renderTemplate(line, job.scope, `${job.kit.file} gitignore`),
    );
    drafts.push({
      path,
      strategy: 'blocks',
      module: manifest.id,
      blockId: manifest.id,
      content: asLfText(lines.join('\n')),
    });
  }
  return drafts;
}

function jsonDraft(id: string, path: string, part: JsonPart): Draft {
  return { path, strategy: 'json', module: id, content: toJson(part.value), keys: part.keys };
}

function jsonDrafts(job: ModuleRender, file: ManifestFile, path: string): Draft[] {
  const { manifest } = job.kit;
  if (file.to === MCP_FILE) return [jsonDraft(manifest.id, path, mcpPart(manifest))];
  const unique = [...new Set(manifest.hooks.map((hook) => hook.script))];
  const scripts: Draft[] = unique.map((script) => ({
    path: hookScriptPath(script, job.brand),
    strategy: 'owned',
    module: manifest.id,
    content: asLfText(source(job.kit, script)),
  }));
  return [jsonDraft(manifest.id, path, settingsPart(manifest, job.brand)), ...scripts];
}

function fileDrafts(job: ModuleRender, file: ManifestFile, index: number): Draft[] {
  const path = renderedPath(job, file, index);
  const { id } = job.kit.manifest;
  switch (file.strategy) {
    case 'blocks':
      return blockDrafts(job, file, path);
    case 'json':
      return jsonDrafts(job, file, path);
    default:
      return [{ path, strategy: file.strategy, module: id, content: template(job, file.from) }];
  }
}

function moduleDrafts(job: ModuleRender): Draft[] {
  const { manifest } = job.kit;
  const options = job.context.options?.get(manifest.id) ?? optionDefaults(manifest);
  return manifest.files.flatMap((file, index) =>
    whenMismatch(file.when, job.context.stack, options) === undefined ? fileDrafts(job, file, index) : [],
  );
}

/**
 * Renders modules into a virtual tree of project paths (#20). The same modules, context and brand give the same
 * bytes on every run and OS and in any module order: output is LF, sorted, and reads no clock, path or
 * environment. JSON is built from objects. Two modules writing one owned path, block or JSON entry throw RenderError.
 */
export function render(
  modules: readonly KitModule[],
  context: RenderContext,
  brand: Brand = BRAND,
): RenderTree {
  const scope: TemplateScope = { ...context.values, brand: brandScope(brand) };
  const drafts = modules.flatMap((kit) => moduleDrafts({ kit, context, scope, brand }));
  return collectEntries(drafts);
}
