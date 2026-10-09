#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/core/brand.ts';
import { exitWith, repositoryFiles } from './lib.mjs';

const BRAND_SOURCE = 'src/core/brand.ts';

// The slug may appear only in the brand itself, package and release metadata (.changeset/ names the
// package), generated output and docs, plus this repo's own dogfood setup: .claude/, the guard tests,
// and the two tools that recognise its pragma.
const ALLOWED_FILES = new Set([
  BRAND_SOURCE,
  'package.json',
  'package-lock.json',
  'LICENSE',
  'eslint.config.mjs',
  'scripts/check-comments.mjs',
  'test/guards.test.ts',
]);
const ALLOWED_DIRECTORIES = [
  /^plugin\//,
  /^docs\//,
  /^\.claude\//,
  /^\.changeset\//,
  /^\.github\/ISSUE_TEMPLATE\//,
];
const ROOT_MARKDOWN = /^[^/]+\.md$/;

/** Returns true for files where the slug is allowed to appear. */
function isAllowed(file) {
  return (
    ALLOWED_FILES.has(file) ||
    ROOT_MARKDOWN.test(file) ||
    ALLOWED_DIRECTORIES.some((directory) => directory.test(file))
  );
}

/** Reads a text file, or returns undefined for missing and binary files. */
function readText(file) {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return text.includes('\0') ? undefined : text;
}

/** Returns `path:line` findings for every slug literal outside the allowlist. */
function slugLeaks(root, slugs) {
  const findings = [];
  const nextStep = 'Run it inside the git repository, or pass the repository root as the first argument.';
  for (const file of repositoryFiles(root, nextStep).filter((candidate) => !isAllowed(candidate))) {
    const lines = readText(path.join(root, file))?.split('\n') ?? [];
    lines.forEach((line, index) => {
      const slug = slugs.find((candidate) => line.includes(candidate));
      if (!slug) return;
      findings.push(`${file}:${String(index + 1)}  "${slug}" belongs in ${BRAND_SOURCE}; use BRAND`);
    });
  }
  return findings;
}

/** Checks that the package name and its single bin match BRAND. */
function packageProblems(root) {
  const manifest = path.join(root, 'package.json');
  if (!existsSync(manifest)) return [`package.json not found in ${root}`];
  const { name, bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  const problems = [];
  if (name !== BRAND.npmName) problems.push(`package.json name "${name}" differs from BRAND.npmName`);
  const binNames = bin !== null && typeof bin === 'object' ? Object.keys(bin) : [];
  if (binNames.length !== 1 || binNames[0] !== BRAND.binName) {
    problems.push(`package.json bin must map exactly one command, BRAND.binName (found: ${binNames.join()})`);
  }
  return problems;
}

const root = path.resolve(process.argv[2] ?? '.');
const slugs = [
  ...new Set([BRAND.npmName, BRAND.binName, BRAND.pluginName, BRAND.marketplaceName, ...BRAND.legacySlugs]),
];
const problems = [...packageProblems(root), ...slugLeaks(root, slugs)];
if (problems.length > 0) {
  exitWith(`Brand check failed (see ${BRAND_SOURCE}):\n${problems.join('\n')}`, 1);
}
