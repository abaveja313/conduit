import { defineConfig } from 'vitest/config';

export const baseConfig = defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
      ],
    },
  },
  resolve: {
    extensions: ['.js', '.ts', '.json'],
  },
});

export const nodeConfig = defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    environment: 'node',
  },
});

export const browserConfig = defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    environment: 'happy-dom',
  },
});
