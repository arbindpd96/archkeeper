import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const readability = {
  complexity: ['error', 10],
  'max-depth': ['error', 3],
  'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-nested-callbacks': ['error', 3],
  'max-params': ['error', 4],
  'no-console': 'error',
  'no-else-return': 'error',
  eqeqeq: ['error', 'always'],
  'object-shorthand': 'error',
  'prefer-const': 'error',
};

const commentPolicy = {
  'no-inline-comments': ['error', { ignorePattern: 'archkeeper:' }],
  'jsdoc/require-jsdoc': [
    'error',
    {
      publicOnly: true,
      require: {
        ArrowFunctionExpression: true,
        ClassDeclaration: true,
        FunctionDeclaration: true,
        FunctionExpression: true,
      },
      contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
      enableFixer: false,
    },
  ],
  'jsdoc/require-param': 'off',
  'jsdoc/require-returns': 'off',
  'jsdoc/require-yields': 'off',
  'jsdoc/require-throws': 'off',
  'jsdoc/informative-docs': 'error',
  'jsdoc/no-blank-blocks': 'error',
  'jsdoc/no-blank-block-descriptions': 'error',
  '@eslint-community/eslint-comments/require-description': 'error',
};

const CORE_IS_PURE =
  'src/core is pure (ADR-0011): return data or throw, and let src/cli own prompts, output and exit codes.';
const HOOKS_ARE_STANDALONE =
  'Hooks are self-contained bundles (ADR-0011): import only node: built-ins and ./runtime/.';
const RUNTIME_HAS_NO_PACKAGES = 'The hook runtime imports no npm package (ADR-0011): use node: built-ins.';

/** Layer boundaries from ADR-0011; test/layer-boundaries.test.ts proves each one with a fixture. */
const layerBoundaries = [
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:process', importNames: ['exit'], message: CORE_IS_PURE },
            { name: 'process', importNames: ['exit'], message: CORE_IS_PURE },
            { name: 'node:console', message: CORE_IS_PURE },
            { name: 'console', message: CORE_IS_PURE },
          ],
          patterns: [
            { group: ['**/cli', '**/cli/**'], message: CORE_IS_PURE },
            { group: ['commander', 'commander/**', '@clack/**'], message: CORE_IS_PURE },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'exit', message: CORE_IS_PURE },
        { object: 'globalThis', property: 'console', message: CORE_IS_PURE },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='exit'][object.property.name='process']",
          message: CORE_IS_PURE,
        },
      ],
      'no-restricted-globals': ['error', { name: 'console', message: CORE_IS_PURE }],
    },
  },
  {
    files: ['src/hooks/**/*.ts'],
    ignores: ['src/hooks/runtime/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: String.raw`^(?!node:|\./runtime/)`, message: HOOKS_ARE_STANDALONE }] },
      ],
    },
  },
  {
    files: ['src/hooks/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: String.raw`^(?![./]|node:)`, message: RUNTIME_HAS_NO_PACKAGES }] },
      ],
    },
  },
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      'plugin/',
      '**/fixtures/',
      '.claude/state/',
      '.claude/worktrees/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  comments.recommended,
  jsdoc.configs['flat/recommended-typescript-error'],
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...readability,
      ...commentPolicy,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
  },
  {
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-nested-callbacks': ['error', 4],
      'jsdoc/require-jsdoc': 'off',
    },
  },
  ...layerBoundaries,
  prettier,
);
