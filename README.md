# 🚇 Conduit

**Conduit** is a Rust → WebAssembly framework for running [Model Context Protocol (MCP)](https://modelcontextprotocol.io)  
tools directly in the browser with a new lightweight **MCP-over-WASM protocol**.

Currently focused on secure, zero-install **file access and editing**, Conduit lets web apps interact with user-granted directories while keeping all data on-device. Rust tools are compiled to WASM and executed in a browser Worker, with a JSON-RPC transport that supports progress, cancellation, and streaming results. Indexes and caches are stored in OPFS (Origin Private File System) for performance and persistence.

---

### Key Features (MVP)
- **Rust-first toolchain** → Write tools in Rust, compile to WASM, run in the browser.
- **New protocol** → Browser-friendly MCP transport designed for Workers.
- **File access** → Read/write user-granted directories; atomic writes, optimistic concurrency, undo journal.
- **Local persistence** → OPFS-backed indexes and caches.
- **Zero-install** → Tools ship as signed WASM modules; permissions are granted per origin.
- **Privacy & security** → Data never leaves the machine; execution sandboxed with explicit user consent.