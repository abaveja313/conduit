# 🚇 Conduit

[![CI](https://github.com/abaveja313/conduit/actions/workflows/ci.yml/badge.svg)](https://github.com/abaveja313/conduit/actions/workflows/ci.yml)

Conduit is a first-of-its-kind **in-browser MCP server *and* client**. It lets agents operate on your local file system directly from the browser—no native app, no per-file uploads—by combining a custom **Web Worker–based MCP transport** with the **File System Access API** and a high-performance **Rust→WASM** core. The server runs inside a dedicated worker so it never blocks the UI, and the client can be extended with additional tools to expose safe, scoped capabilities to agents.

# Usage
Prereqs: Rust (stable) + Cargo, Node 18+ (npm or pnpm), and the `wasm32-unknown-unknown` target.

```bash
# one-time Rust target for WASM
rustup target add wasm32-unknown-unknown

# clone
git clone https://github.com/abaveja313/conduit.git
cd conduit

# install JS deps (choose one)
pnpm i || npm i

# build Rust crates
cargo build -p conduit-core
cargo build -p conduit-wasm --target wasm32-unknown-unknown --release

# start the dev app
pnpm dev || npm run dev
```
