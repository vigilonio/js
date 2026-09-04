#!/usr/bin/env bash
# Packs the workspace packages and installs them into a throwaway npm
# project, verifying the artifacts a consumer actually receives: both CJS
# and ESM entry points resolve and load, and the public API is exported.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$repo_root/packages/node" && pnpm pack --out "$tmp/node.tgz")

cd "$tmp"
npm init -y >/dev/null
npm install --no-save --no-audit --no-fund ./node.tgz >/dev/null

node -e '
const node = require("@vigilon/node");
const assert = require("assert");
assert(typeof node.register === "function", "register");
assert(typeof node.shutdown === "function", "shutdown");
assert(typeof node.recordException === "function", "recordException");
assert(typeof node.withJobMonitor === "function", "withJobMonitor");
assert(require.resolve("@vigilon/node/register").endsWith("register.cjs"), "register preload (CJS)");
console.log("smoke: CJS OK");
'

node --input-type=module -e '
import { register, shutdown, recordException, withJobMonitor } from "@vigilon/node";
import assert from "assert";
assert(typeof register === "function");
assert(typeof shutdown === "function");
assert(typeof recordException === "function");
assert(typeof withJobMonitor === "function");
console.log("smoke: ESM OK");
'

echo "smoke: OK"
