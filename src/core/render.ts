import { BRAND, type Brand } from './brand.js';
import { RenderError } from './errors.js';
import { type KitModule, templatePath } from './loader.js';
import { GITIGNORE_FILE, ignoreLineProblem, MCP_FILE, type ModuleManifest } from './manifest-schema.js';
import { moduleOptions, type ResolvedOptions } from './options.js';
import { relativePathProblem, targetPathProblem } from './paths.js';
import { hookScriptPath, type JsonPart, mcpPart, settingsPart, toJson } from './render-json.js';
import { collectEntries, type Draft, type RenderTree } from './render-tree.js';
import type { Stack } from './schema-parts.js';
import { importProblem } from './imports.js';
import { markerIn } from './markers.js';
import { findSecret } from './secrets.js';
import { reservedTarget } from './targets.js';
import { brandScope, renderTemplate, type TemplateScope, unsafeValue } from './template.js';
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
  const problem = targetPathProblem(path);
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

// A template value can start with ! and a brand value can hold a newline, so each rendered line is checked again.
function ignoreLine(job: ModuleRender, line: string, index: number): string {
  const location = `gitignore[${String(index)}]`;
  const rendered = renderTemplate(line, job.scope, `${job.kit.file} ${location}`);
  const problem = ignoreLineProblem(rendered);
  if (problem === undefined) return rendered;
  throw new RenderError({
    file: job.kit.file,
    location,
    problem: `renders to ${JSON.stringify(rendered)}, which ${problem}`,
    hint: 'fix the template value it uses: a line renders to one pattern, never a comment, blank or ! negation',
  });
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
    const lines = manifest.gitignore.map((line, index) => ignoreLine(job, line, index));
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

function installedHookPath(job: ModuleRender, script: string): string {
  const path = hookScriptPath(script, job.brand);
  const problem = relativePathProblem(path);
  if (problem === undefined) return path;
  const index = job.kit.manifest.hooks.findIndex((hook) => hook.script === script);
  throw new RenderError({
    file: job.kit.file,
    location: `hooks[${String(index)}].script`,
    problem: `installs to "${path}", which ${problem}`,
    hint: 'fix the hookDir of the brand',
  });
}

function jsonDrafts(job: ModuleRender, file: ManifestFile, path: string): Draft[] {
  const { manifest } = job.kit;
  if (file.to === MCP_FILE) return [jsonDraft(manifest.id, path, mcpPart(manifest))];
  const unique = [...new Set(manifest.hooks.map((hook) => hook.script))];
  const scripts: Draft[] = unique.map((script) => ({
    path: installedHookPath(job, script),
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
  const options = moduleOptions(job.context.options, manifest);
  return manifest.files.flatMap((file, index) =>
    whenMismatch(file.when, job.context.stack, options) === undefined ? fileDrafts(job, file, index) : [],
  );
}

// The schema keeps literal values out of env, headers and URL queries and refuses key-like text in URLs and stdio
// arguments; this catches a known token format anywhere else, such as a template (ADR-0007).
function refuseSecrets(tree: RenderTree): void {
  for (const [path, entries] of tree) {
    for (const { content, module } of entries) {
      const secret = findSecret(content);
      if (secret === undefined) continue;
      throw new RenderError({
        file: path,
        location: '',
        problem: `would get a likely ${secret.name} from ${module}, on line ${String(secret.line)} of its entry`,
        hint: 'reference the value as ${NAME} or use OAuth: the kit never writes a secret into a project',
      });
    }
  }
}

// Two values side by side, such as `x @` and `~/.ssh/id_rsa`, can form an import no single value holds.
function refuseImports(tree: RenderTree): void {
  for (const [path, entries] of tree) {
    if (!path.toLowerCase().endsWith('.md')) continue;
    for (const { content, module } of entries) {
      const problem = importProblem(content);
      if (problem === undefined) continue;
      throw new RenderError({
        file: path,
        location: '',
        problem: `${problem.replace(/^holds/, 'would get')} from ${module}`,
        hint: 'import only ordinary project files, such as AGENTS.md: Claude Code loads @ imports into every session',
      });
    }
  }
}

// A template can hold a marker itself, which would end its own block early when the file is parsed again.
function refuseMarkers(tree: RenderTree, brand: Brand): void {
  for (const [path, entries] of tree) {
    for (const { content, module, strategy } of entries) {
      const marker = strategy === 'blocks' ? markerIn(content, brand) : undefined;
      if (marker === undefined) continue;
      throw new RenderError({
        file: path,
        location: '',
        problem: `would get ${marker} from ${module}, which marks a managed block`,
        hint: 'remove the marker from the template: the kit writes the markers around each block itself',
      });
    }
  }
}

function checkValues(values: TemplateScope | undefined, brand: Brand): void {
  const unsafe = values === undefined ? undefined : unsafeValue(values, brand);
  if (unsafe === undefined) return;
  throw new RenderError({
    file: 'template values',
    location: unsafe.name,
    problem: unsafe.problem,
    hint: 'pass one line of text with no block marker and no @ import of an outside or private file: a value fills its template as is',
  });
}

/**
 * Renders modules into a virtual tree of project paths (#20). The same modules, context and brand give the same
 * bytes on every run and OS and in any module order: output is LF, sorted, and reads no clock, path or
 * environment. JSON is built from objects. A template value with a control character or a block marker, two
 * modules writing one owned path, block or JSON entry, a block that holds a marker, or output that holds a likely
 * secret throw RenderError.
 */
export function render(
  modules: readonly KitModule[],
  context: RenderContext,
  brand: Brand = BRAND,
): RenderTree {
  checkValues(context.values, brand);
  const scope: TemplateScope = { ...context.values, brand: brandScope(brand) };
  const drafts = modules.flatMap((kit) => moduleDrafts({ kit, context, scope, brand }));
  const tree = collectEntries(drafts);
  refuseSecrets(tree);
  refuseImports(tree);
  refuseMarkers(tree, brand);
  return tree;
}
