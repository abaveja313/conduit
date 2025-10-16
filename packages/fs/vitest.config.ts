import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'happy-dom',
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