import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'remove-use-client',
      transform(code, id) {
        if (id.includes('node_modules')) return;
        if (id.endsWith('.tsx') || id.endsWith('.ts')) {
          return code.replace(/^['"]use client['"][\s;]*/m, '');
        }
      },
    },
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@conduit/fs': path.resolve(__dirname, '../../packages/fs/src'),
      '@conduit/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@conduit/wasm': path.resolve(__dirname, '../../packages/wasm'),
    },
  },
});
