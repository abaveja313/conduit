import { build } from 'esbuild';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const isWatch = process.argv.includes('--watch');
const isDev = process.env.NODE_ENV === 'development' || isWatch;

const baseConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser', // Client runs in main thread browser context
  target: ['es2022'],
  format: 'esm',
  sourcemap: isDev,
  minify: !isDev,
  
  // External dependencies (don't bundle shared utilities)
  external: ['@conduit/shared'],
  
  // Define globals
  define: {
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    'process.env.PACKAGE_NAME': JSON.stringify(packageJson.name),
    'process.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
  },
  
  // Main thread browser context
  conditions: ['browser'],
  
  // Resolve workspace dependencies
  plugins: [{
    name: 'workspace-resolver',
    setup(build) {
      // Handle @conduit/* workspace packages
      build.onResolve({ filter: /^@conduit\// }, args => {
        // Let esbuild handle workspace resolution for non-external packages
        return null;
      });
    }
  }],
};

// Client library bundle
const clientConfig = {
  ...baseConfig,
  outfile: 'dist/index.js',
  banner: {
    js: '// Conduit Worker Client - Generated Bundle'
  }
};

async function buildAll() {
  try {
    console.log(`Building ${packageJson.name} (${isDev ? 'development' : 'production'})...`);
    
    if (isWatch) {
      // Watch mode for development
      const ctx = await build({ ...clientConfig, watch: true });
      
      console.log('Watching for changes...');
      
      // Keep process alive
      process.on('SIGINT', async () => {
        await ctx.dispose();
        process.exit(0);
      });
    } else {
      // Single build
      await build(clientConfig);
      console.log('Build completed successfully!');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildAll();
