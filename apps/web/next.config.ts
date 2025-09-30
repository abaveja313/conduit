import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    return config;
  },
  // COEP/COOP headers are NOT needed for File System Access API
  // Only needed for SharedArrayBuffer, OPFS, or WebAssembly threads
  // Removing these allows Google Analytics, Mixpanel, and other third-party services to work
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Standard security headers without cross-origin isolation
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
