import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules', 'coverage', '.data'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  { files: ['scripts/**/*.js'], rules: { 'no-console': 'off' } },
];
