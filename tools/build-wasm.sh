#!/usr/bin/env bash
set -euo pipefail
CRATE=conduit-wasm
TARGET=wasm32-unknown-unknown
MODE=release
OUT=artifacts/wasm
BIN_PATH="target/${TARGET}/${MODE}/conduit_wasm.wasm"

echo "Building ${CRATE} for ${TARGET} (${MODE})..."
cargo build -p "${CRATE}" --target "${TARGET}" --${MODE}

mkdir -p "${OUT}"
cp "${BIN_PATH}" "${OUT}/conduit.wasm"

# Hash (sha256)
if command -v shasum >/dev/null 2>&1; then
  HASH=$(shasum -a 256 "${OUT}/conduit.wasm" | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  HASH=$(sha256sum "${OUT}/conduit.wasm" | awk '{print $1}')
else
  HASH="(sha256 unavailable)"
fi

# Build manifest
cat > "${OUT}/manifest.json" <<JSON
{
  "crate": "${CRATE}",
  "target": "${TARGET}",
  "mode": "${MODE}",
  "hash_sha256": "${HASH}"
}
JSON

echo "✅ WASM artifact at ${OUT}/conduit.wasm"
