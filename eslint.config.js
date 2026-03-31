// @ts-check
'use strict';

const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      '**/dist/**',
      '**/.pnvm/**',
      '**/node_modules/**',
      'workspace/**',
      'scripts/**/*.js',
      // control uses Vite + react-hooks plugin — lint separately via its own config
      'packages/control/**',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Errors — things that are always wrong
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Best practices
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // Test files — relax unused-vars (test scaffolding often imports helpers that become unused)
  {
    files: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
