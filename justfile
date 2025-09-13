default:
    @just --list

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
    # Type checking for TypeScript packages
    @echo "Checking TypeScript types..."
    @find . -name "tsconfig.json" -not -path "*/node_modules/*" -not -path "*/.next/*" -not -path "*/dist/*" -execdir sh -c 'echo "Checking $(pwd)..." && npx tsc --noEmit' \;

test:
    cargo test --workspace --locked
    pnpm turbo run test

build: build-rust build-wasm build-node

build-rust:
    cargo build --workspace

build-wasm:
    wasm-pack build crates/conduit-wasm --target web --out-dir ../../packages/wasm/pkg

build-node:
    pnpm turbo run build

release:
    cargo builnd --release --workspace
    wasm-pack build crates/conduit-wasm --target web --out-dir ../../packages/wasm/pkg --release
    pnpm turbo run build -- --mode production

dev:
    #!/usr/bin/env bash
    trap 'kill %1' INT
    cargo watch -x run &
    pnpm turbo run dev
    wait

clean:
    cargo clean
    rm -rf .turbo node_modules dist packages/wasm/pkg

update:
    cargo update
    pnpm update --interactive

# Run formatting and linting on staged files (used by git hooks)
pre-commit: fmt-staged

# Run full formatting and linting on all files
pre-commit-all: fmt lint