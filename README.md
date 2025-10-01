# 🚇 Conduit

[![CI](https://github.com/abaveja313/conduit/actions/workflows/ci.yml/badge.svg)](https://github.com/abaveja313/conduit/actions/workflows/ci.yml)
![Last commit](https://img.shields.io/github/last-commit/abaveja313/conduit?label=Last%20updated)
![License](https://img.shields.io/badge/license-Apache%202.0-green)

Conduit is an in-browser **AI-powered file system tool**. AI agents can operate on your local file system directly in the browser with no native app and no per-file uploads. Conduit combines the **File System Access API**, **direct type-safe tools**, and a **Rust → WASM** core for high-performance file operations. The tools expose simple, type-safe functions that can be integrated with any LLM framework.

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

## Architecture

Conduit provides direct, type-safe file system tools that can be integrated with any LLM framework:

- **File Tools**: Type-safe functions for reading, creating, and deleting files
- **WASM Core**: High-performance Rust implementation for file scanning and indexing
- **Browser Integration**: Direct access to local file system via File System Access API
- **AI Ready**: Simple function interfaces compatible with any LLM tool-calling framework

## Usage

Prerequisites: Rust, Node.js 18+, pnpm, wasm-pack, just

```bash
# Setup
git clone https://github.com/abaveja313/conduit.git
cd conduit
rustup target add wasm32-unknown-unknown

# Run
just prepare  # Install deps and build WASM
just start    # Start dev server
```

App runs at http://localhost:3000
