import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'remove-use-client',
      enforce: 'pre',
      transform(code, id) {
        if (id.includes('node_modules')) return;
        if ((id.endsWith('.tsx') || id.endsWith('.ts')) && code.includes('use client')) {
          const newCode = code.replace(/^['"]use client['"];?\s*/m, '');
          return {
            code: newCode,
            map: null,
          };
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
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
