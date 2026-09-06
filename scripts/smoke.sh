#!/usr/bin/env bash
# Packs the workspace packages, installs them into a throwaway npm project
# together with Express, and runs the real preload entrypoints — --import for
# both CJS and ESM apps, plus the legacy --require for CJS — against a local
# OTLP receiver. Each variant must export both an HTTP server span and an
# Express span, which is what verifies the loader-hook wiring a consumer
# actually depends on. A final variant drops the VIGILON_SERVICE_NAME and
# VIGILON_SERVICE_VERSION variables to check that the defaults are derived
# from the project's package.json.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
collector_pid=""

cleanup() {
  # Preserve the script's own status: killing the collector is expected and
  # must not turn a passing run into exit 143.
  local status=$?
  if [ -n "$collector_pid" ]; then
    kill "$collector_pid" 2>/dev/null || true
    wait "$collector_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT

(cd "$repo_root/packages/node" && pnpm pack --out "$tmp/node.tgz")

cd "$tmp"
npm init -y >/dev/null
npm pkg set name=smoke-derived-service version=9.9.9
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
  local markers=$2
  shift 2
  : > collector.log
  "$@"
  # shellcheck disable=SC2086
  node assert.mjs "$label" $markers
}

spans="httpServerSpan expressSpan"
run_variant "CJS --import" "$spans" node --import @vigilon/node/register app.cjs
run_variant "ESM --import" "$spans" node --import @vigilon/node/register app.mjs
run_variant "CJS --require" "$spans" node --require @vigilon/node/register app.cjs
run_variant "CJS NODE_OPTIONS" "$spans" \
  env NODE_OPTIONS="--import @vigilon/node/register" node app.cjs

# Derived defaults: service name and version come from package.json, the
# environment from the generic ENVIRONMENT variable. The npm_package_*
# variables are unset because `pnpm smoke` leaks the workspace's own values
# into this shell.
run_variant "derived defaults" "$spans derivedServiceName derivedServiceVersion" \
  env -u VIGILON_SERVICE_NAME -u VIGILON_SERVICE_VERSION -u VIGILON_ENVIRONMENT \
  -u npm_package_name -u npm_package_version \
  ENVIRONMENT=smoke node --import @vigilon/node/register app.cjs

echo "smoke: OK"
