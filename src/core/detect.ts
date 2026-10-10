import { nodeSignals } from './detect-node.js';
import { pythonSignals } from './detect-python.js';
import type { Stack } from './schema-parts.js';
import {
  type ClaudeSetup,
  FRAMEWORKS,
  inOrder,
  LANGUAGES,
  type ProjectView,
  type StackProfile,
  type StackSignals,
  TOOL_JOBS,
  type ToolsByJob,
} from './stack-profile.js';

/** Root docs that instructions may point to, in this order, matched in any case. */
const DOC_NAMES = ['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md'];

function claudeSetup(view: ProjectView, names: readonly string[]): ClaudeSetup {
  const claude = names.includes('.claude') ? view.list('.claude') : [];
  return {
    claudeMd: names.includes('CLAUDE.md'),
    agentsMd: names.includes('AGENTS.md'),
    settings: claude.includes('settings.json'),
    hooks: claude.includes('hooks'),
    skills: claude.includes('skills'),
  };
}

// The name as it is on disk, so a pointer opens on a case-sensitive file system too.
function docNames(names: readonly string[]): string[] {
  return DOC_NAMES.flatMap((doc) =>
    names.filter((name) => name.toLowerCase() === doc.toLowerCase()).slice(0, 1),
  );
}

function toolsByJob(tools: readonly string[]): ToolsByJob {
  return {
    formatters: inOrder(TOOL_JOBS.formatters, tools),
    linters: inOrder(TOOL_JOBS.linters, tools),
    typeCheckers: inOrder(TOOL_JOBS.typeCheckers, tools),
    testRunners: inOrder(TOOL_JOBS.testRunners, tools),
  };
}

/**
 * Detects a project's stack from a view of it (#25, ADR-0006): languages, the package manager, formatters,
 * linters, type checkers, test runners, frameworks, a monorepo flag, the commands its scripts and tools give, its
 * root docs and any Claude Code setup it already has. Pure: it reads only through `view`, starts no process and
 * opens no connection. A file it cannot parse, such as malformed TOML, becomes a warning and the rest still counts.
 */
export function detectStack(view: ProjectView): StackProfile {
  const names = view.list('');
  const node = nodeSignals(view, names);
  const python = pythonSignals(view, names);
  const found: StackSignals[] = [node, python].filter((signals) => signals !== undefined);
  const stack: Stack[] = [
    ...(node === undefined ? [] : ['ts' as const]),
    ...(python === undefined ? [] : ['python' as const]),
  ];
  return {
    stack,
    languages: inOrder(
      LANGUAGES,
      found.flatMap((signals) => signals.languages),
    ),
    packageManager: node?.packageManager ?? null,
    pythonManager: python?.pythonManager ?? null,
    tools: toolsByJob(found.flatMap((signals) => signals.tools)),
    frameworks: inOrder(
      FRAMEWORKS,
      found.flatMap((signals) => signals.frameworks),
    ),
    monorepo: found.some((signals) => signals.monorepo),
    commands: found.flatMap((signals) => signals.commands),
    docs: docNames(names),
    claude: claudeSetup(view, names),
    warnings: found.flatMap((signals) => signals.warnings),
  };
}
