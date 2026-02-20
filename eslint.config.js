import js from '@eslint/js'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import sortKeys from 'eslint-plugin-sort-keys'
import globals from 'globals'
import ts from 'typescript-eslint'

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    ignores: ['**/generated/**', '**/dist/**'],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    plugins: { 'sort-keys': sortKeys },
    rules: {
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': 'off',
      'no-shadow': 'warn',
      'object-shorthand': 'warn',
      'sort-keys/sort-keys-fix': ['error', 'asc', { natural: true }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.integration.test.ts'],
    rules: {
      'max-lines': 'off',
    },
  },
]
