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
      'no-shadow': 'warn',
      'object-shorthand': 'warn',
      'sort-keys/sort-keys-fix': ['error', 'asc', { natural: true }],
    },
  },
]
