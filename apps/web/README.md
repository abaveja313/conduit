# Conduit Web App

AI-powered file system assistant using WebAssembly.

## Quick Start

```bash
just prepare
just start
```

## Browser Support

Requires Chrome, Edge, or Chromium-based browsers (File System Access API).  
Not supported: Firefox, Safari.

## Optional Features

The app works perfectly without any configuration. Add these only if needed:

### Auth0 (Optional)

```bash
NEXT_PUBLIC_AUTH0_DOMAIN=your-domain.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id
```

### Mixpanel Analytics (Optional)

```bash
NEXT_PUBLIC_MIXPANEL_TOKEN=your-mixpanel-token
```

Copy `.env.example` to `.env.local` and add only what you need.

## Development

```bash
pnpm install
just build-wasm
cd apps/web && pnpm dev
```
