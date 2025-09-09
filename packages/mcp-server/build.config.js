import { build } from 'esbuild';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const isWatch = process.argv.includes('--watch');
const isDev = process.env.NODE_ENV === 'development' || isWatch;

const baseConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser', // Worker runs in browser context
  target: ['es2022'],
  format: 'esm',
  sourcemap: isDev,
  minify: !isDev,
  
  // External dependencies that should not be bundled
  external: [],
  
  // Define globals for worker context
  define: {
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    'process.env.PACKAGE_NAME': JSON.stringify(packageJson.name),
    'process.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
  },
  
  // Worker-specific configurations
  conditions: ['worker', 'browser'],
  
  // Resolve workspace dependencies
  plugins: [{
    name: 'workspace-resolver',
    setup(build) {
      // Handle @conduit/* workspace packages
      build.onResolve({ filter: /^@conduit\// }, args => {
        // Let esbuild handle workspace resolution
        return null;
      });
    }
  }],
};

// Main worker bundle (for loading with new Worker())
const workerConfig = {
  ...baseConfig,
  outfile: 'dist/worker.js',
  banner: {
    js: '// Conduit Worker Server - Generated Bundle'
  }
};

// Library bundle (for importing in main thread)
const libConfig = {
  ...baseConfig,
  outfile: 'dist/index.js',
  external: ['@conduit/shared'], // Don't bundle shared utilities in lib
  banner: {
    js: '// Conduit Worker Server Library - Generated Bundle'
  }
};

async function buildAll() {
  try {
    console.log(`Building ${packageJson.name} (${isDev ? 'development' : 'production'})...`);
    
    if (isWatch) {
      // Watch mode for development
      const workerCtx = await build({ ...workerConfig, watch: true });
      const libCtx = await build({ ...libConfig, watch: true });
      
      console.log('Watching for changes...');
      
      // Keep process alive
      process.on('SIGINT', async () => {
        await workerCtx.dispose();
        await libCtx.dispose();
        process.exit(0);
      });
    } else {
      // Single build
      await Promise.all([
        build(workerConfig),
        build(libConfig)
      ]);
      
      console.log('Build completed successfully!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildAll();
