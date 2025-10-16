default:
    @just --list

# Quick start recipes
quick-start: start-fresh
run: start

ci: install lint audit test build

install:
    pnpm install --frozen-lockfile
    cargo fetch

lint:
    cargo fmt --all -- --check
    cargo clippy --all-targets --all-features -- -D warnings
    pnpm turbo run lint

fmt:
    cargo fmt --all
    pnpm prettier --write .

# Format only staged files (used by git hooks)
fmt-staged:
    npx lint-staged

audit:
    cargo audit
    pnpm audit --audit-level moderate

check:
    cargo check --workspace --all-targets
    pnpm turbo run type-check

test:
    cargo test --workspace --locked
    pnpm turbo run test -- --run

test-watch:
    cargo test --workspace --locked
    pnpm turbo run test

# Run tests for a specific package (e.g., just test-pkg server)
test-pkg package:
    cd packages/{{package}} && npm test -- --run

# Run tests for a specific package in watch mode
test-pkg-watch package:
    cd packages/{{package}} && npm test

build: build-rust build-wasm build-node

build-rust:
    cargo build --workspace

build-wasm:
    wasm-pack build crates/conduit-wasm --target web --out-dir ../../packages/wasm/pkg
    @echo "Copying WASM file to web app..."
    @mkdir -p apps/web/public/workers
    @cp packages/wasm/pkg/conduit_wasm_bg.wasm apps/web/public/workers/conduit.wasm

build-node:
    pnpm turbo run build

# Build production versions of everything
release:
    @echo "Building production release..."
    cargo build --release --workspace
    wasm-pack build crates/conduit-wasm --target web --out-dir ../../packages/wasm/pkg --release
    @echo "Copying WASM file to web app..."
    @mkdir -p apps/web/public/workers
    @cp packages/wasm/pkg/conduit_wasm_bg.wasm apps/web/public/workers/conduit.wasm
    pnpm turbo run build
    @echo "Production build complete!"
    @echo "- Rust binaries in target/release/"
    @echo "- WASM module in packages/wasm/pkg/"
    @echo "- Web app in apps/web/.next/"

# Prepare the app with all necessary builds and start the dev server
prepare:
    @echo "Installing dependencies..."
    pnpm install
    @echo "Building WASM module..."
    @just build-wasm
    @echo "Building TypeScript packages..."
    pnpm --filter="!web" run build
    @echo "App is ready! Run 'just start' to launch the dev server."

# Start the web app in development mode (assumes prepare has been run)
start:
    @echo "Starting web app on http://localhost:3000..."
    cd apps/web && pnpm dev

# Start the web app with Vercel CLI to test Vercel features (rewrites, etc)
start-vercel:
    @echo "Starting web app with Vercel CLI on http://localhost:3000..."
    cd apps/web && pnpm vercel-dev

# Build and start in one command
start-fresh: prepare start

# Run development servers (TypeScript packages in watch mode)
dev:
    pnpm turbo run dev

clean:
    cargo clean
    rm -rf .turbo node_modules dist packages/wasm/pkg
    rm -rf apps/web/.next apps/web/public/workers/*.wasm

update:
    cargo update
    pnpm update --interactive

# Run formatting and linting on staged files (used by git hooks)
pre-commit: fmt-staged build-wasm audit

# Run full formatting and linting on all files
pre-commit-all: fmt lint