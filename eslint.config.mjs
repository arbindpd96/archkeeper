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
  prettier,
);
