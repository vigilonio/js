#!/usr/bin/env bash
# Packs the workspace packages, installs them into a throwaway npm project
# together with Express, and runs the real preload entrypoints — CJS via
# --require and ESM via --import — against a local OTLP receiver. Each
# variant must export both an HTTP server span and an Express span, which is
# what verifies the loader-hook wiring a consumer actually depends on.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
collector_pid=""
trap '{ [ -n "$collector_pid" ] && kill "$collector_pid" && wait "$collector_pid"; } 2>/dev/null; rm -rf "$tmp"' EXIT

(cd "$repo_root/packages/node" && pnpm pack --out "$tmp/node.tgz")

cd "$tmp"
npm init -y >/dev/null
npm install --no-save --no-audit --no-fund ./node.tgz express >/dev/null
cp "$repo_root"/scripts/smoke/*.mjs "$repo_root"/scripts/smoke/*.cjs .

node collector.mjs > collector.port &
collector_pid=$!
for _ in $(seq 1 50); do
  [ -s collector.port ] && break
  sleep 0.1
done
port=$(cat collector.port)
[ -n "$port" ] || { echo "smoke: collector did not start"; exit 1; }

export VIGILON_API_KEY=smoke
export VIGILON_SERVICE_NAME=smoke
export VIGILON_ENVIRONMENT=smoke
export VIGILON_SERVICE_VERSION=0.0.0
export VIGILON_OTEL_ENDPOINT="http://127.0.0.1:$port"

run_variant() {
  local label=$1
  shift
  : > collector.log
  "$@"
  node assert.mjs "$label"
}

run_variant "CJS --require" node --require @vigilon/node/register app.cjs
run_variant "ESM --import" node --import @vigilon/node/register app.mjs

echo "smoke: OK"
