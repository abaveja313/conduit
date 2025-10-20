# 🚇 Conduit

[![CI](https://github.com/abaveja313/conduit/actions/workflows/ci.yml/badge.svg)](https://github.com/abaveja313/conduit/actions/workflows/ci.yml)
![Last commit](https://img.shields.io/github/last-commit/abaveja313/conduit?label=Last%20updated)
![License](https://img.shields.io/badge/license-Apache%202.0-green)

Conduit is an in-browser **AI-powered file system tool**. AI agents can operate on your local file system directly in the browser with no native app and no per-file uploads. Conduit combines the **File System Access API**, **direct type-safe tools**, and a **Rust → WASM** core for high-performance file operations. While currently only compatible with Chromium-based browsers, Conduit provides a powerful foundation for AI-assisted file system operations with plans to expand browser support as standards evolve.

## Quick Start

Try Conduit in your browser: [https://conduit.amrit.sh](https://conduit.amrit.sh)

## Browser Compatibility

Conduit requires the File System Access API, which has limited browser support:

| Browser                                                                                                                   | Desktop Support     | Mobile Support |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------- |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/chrome/chrome_64x64.png" width="16" /> Chrome    | ✅ Full (v131+)     | ❌ No          |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/edge/edge_64x64.png" width="16" /> Edge          | ✅ Full (v128+)     | ❌ No          |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/opera/opera_64x64.png" width="16" /> Opera       | ✅ Full (v112+)     | ❌ No          |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/safari/safari_64x64.png" width="16" /> Safari    | ❌ Partial (v15.2+) | ❌ No          |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/firefox/firefox_64x64.png" width="16" /> Firefox | ❌ Partial (v113+)  | ❌ No          |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/main/src/brave/brave_64x64.png" width="16" /> Brave       | ⚠️ Full (with flag) | ❌ No          |

**⚠️ Important:** Full file system access (reading, writing, and directory access) only works on **desktop Chromium browsers**. Safari and Firefox have partial support limited to file picking. Mobile browsers do not support the required APIs.

<sub>Last updated: <time datetime="2025-10-20">October 20, 2025</time></sub>

# Usage

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

## Architecture

Conduit runs entirely in your browser with zero server dependencies:

```
┌─────────────────────────────────────────────────┐
│                 Web Interface                    │
│           (Next.js + TypeScript)                 │
├─────────────────────────────────────────────────┤
│              AI Integration Layer                │
│          (Anthropic Claude Tools)                │
├─────────────────────────────────────────────────┤
│              File System Tools                   │
│         (Type-safe TS/JS Interface)             │
├─────────────────────────────────────────────────┤
│                WASM Core                         │
│        (Rust - High Performance)                 │
├─────────────────────────────────────────────────┤
│         File System Access API                   │
│          (Browser Native API)                    │
└─────────────────────────────────────────────────┘
```

### Key Components

- **WASM Core**: Rust implementation compiled to WebAssembly for fast file scanning, indexing, and pattern matching
- **File System Tools**: Type-safe TypeScript interface providing file operations (read, write, delete, search)
- **AI Integration**: Direct tool functions compatible with Claude and other LLMs supporting function calling
- **Web Workers**: Background processing for file scanning without blocking UI

## Project Structure

The codebase is organized as a monorepo using pnpm workspaces:

```
conduit/
├── apps/
│   └── web/                    # Next.js web application
│       ├── src/
│       │   ├── app/           # App router pages & API routes
│       │   ├── components/    # React components
│       │   └── lib/          # Client utilities & AI integration
│       └── public/
│           └── workers/       # WASM files for web workers
├── crates/                     # Rust packages
│   ├── conduit-core/          # Core file system logic
│   │   └── src/
│   │       ├── fs/           # File system operations
│   │       └── tools/        # AI tool implementations
│   └── conduit-wasm/          # WASM bindings
│       └── src/
│           ├── bindings/     # JS/WASM interface
│           └── orchestrator.rs # Main WASM coordinator
└── packages/                   # TypeScript packages
    ├── fs/                    # File system service layer
    │   └── src/
    │       ├── file-service.ts # Main FS interface
    │       └── scanner.ts     # File scanning logic
    ├── shared/                # Shared utilities
    └── wasm/                  # WASM package distribution
```

### Development Workflow

- **Rust Changes**: Modified in `/crates`, compiled with `wasm-pack`
- **TypeScript Changes**: Modified in `/packages` or `/apps/web`
- **Build Pipeline**: `just prepare` builds WASM and copies to web app

App runs at http://localhost:3000

## Features

- 🔍 **Smart Search**: Regex and content-based file search
- 📁 **Directory Operations**: Navigate and manage folder structures
- ✏️ **File Editing**: Create, move, modify, and delete files
- 🤖 **AI Tools**: Direct integration with Claude for file operations
- 🚀 **Fast Performance**: Rust WASM core handles large codebases
- 🔒 **Privacy First**: All operations happen locally in your browser

## Security

- Files never leave your browser
- No server uploads or cloud storage
- File System Access API requires explicit user permission
- Operations are sandboxed to selected directories

## License

Apache 2.0
