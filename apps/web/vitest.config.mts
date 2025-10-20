/// <reference types="vitest" />
/// <reference types="vite/client" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve } from 'path';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    conditions: ['node', 'import', 'default'],
    alias: {
      '@': resolve(__dirname, './src'),
      '@conduit/fs': resolve(__dirname, '../../packages/fs/src'),
      '@conduit/shared': resolve(__dirname, '../../packages/shared/src'),
      '@conduit/wasm': resolve(__dirname, '../../packages/wasm'),
    },
  },
  // Disable SSR optimization
  ssr: {
    noExternal: true,
  },
});