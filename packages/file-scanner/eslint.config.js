import baseConfig from '../../configs/eslint.base.js';

// Override rules for test files - allow more flexibility
const testOverrides = {
  files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
};

export default [...baseConfig, testOverrides];
