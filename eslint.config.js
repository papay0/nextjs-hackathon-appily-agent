const parser = require('@typescript-eslint/parser');
const plugin = require('@typescript-eslint/eslint-plugin');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'temp/**',
      'data/files/**'
    ]
  },
  // Config for eslint.config.js itself
  {
    files: ['eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        require: 'readonly',
        module: 'writable'
      }
    }
  },
  // Base config for JS files
  js.configs.recommended,
  // TypeScript files config
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json'
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      '@typescript-eslint': plugin
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      'no-console': 'off'
    }
  },
  // Config for debug files - this must come AFTER the TypeScript config to override it
  {
    files: ['**/src/debug*.ts', '**/src/simple-index.ts'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
]; 