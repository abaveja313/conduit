# 🚇 Conduit

[![CI](https://github.com/abaveja313/conduit/actions/workflows/ci.yml/badge.svg)](https://github.com/abaveja313/conduit/actions/workflows/ci.yml)
![Last commit](https://img.shields.io/github/last-commit/abaveja313/conduit?label=Last%20updated)
![License](https://img.shields.io/badge/license-MIT-green)

Conduit is an in-browser **MCP server and client**. Agents can operate on your local file system directly in the browser with no native app and no per-file uploads. Conduit combines a **Web Worker MCP transport**, the **File System Access API**, and a **Rust → WASM** core. The MCP server runs in a dedicated worker so it does not block the UI. The client is extensible with additional tools for safe, scoped capabilities.

## Quick Start

Try Conduit in your browser: [https://conduit.amrit.sh](https://conduit.amrit.sh)

## Requirements

Conduit uses the File System Access API, so it works only in browsers that implement it. See minimum versions and platforms below.

| Browser                                                                                                                   | Min Version.    | Platforms                        |
| ------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------- |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome_64x64.png" width="16" /> Chrome    | 86 / 131+       | Desktop, Android, iOS (partial)  |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge_64x64.png" width="16" /> Edge          | 86 / 128+       | Desktop, Android                 |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera_64x64.png" width="16" /> Opera       | 72 / 112+       | Desktop, Android                 |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/brave/brave_64x64.png" width="16" /> Brave       | n/a             | Desktop (flag), Android (flag)   |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox_64x64.png" width="16" /> Firefox | 113+ (partial)  | Desktop (partial)                |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari_64x64.png" width="16" /> Safari    | 15.2+ (partial) | Desktop (partial), iOS (partial) |

<sub>Last updated: <time datetime="2025-09-26">Sept 26, 2025</time></sub>

## Usage

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
