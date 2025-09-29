# Conduit Web App

File system scanner using WebAssembly.

## Run

From project root:

```bash
just prepare
just start
```

Or manually:

```bash
pnpm install
just build-wasm
cd apps/web && pnpm dev
```

## Browser Support

Requires File System Access API:

- Chrome/Edge 86+
- Opera 72+
- Brave

Not supported: Firefox, Safari
