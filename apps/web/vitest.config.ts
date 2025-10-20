import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
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
