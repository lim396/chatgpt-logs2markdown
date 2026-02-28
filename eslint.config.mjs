import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import prettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,
  prettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
];
