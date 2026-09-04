#!/usr/bin/env bash
# Publishes every workspace package whose current version is not yet on npm.
#
#   scripts/publish.sh <dist-tag>     # latest | beta
#
# Idempotent per package: versions that already exist in the registry are
# skipped, so a partially-published release is recoverable by rerunning.
# `pnpm pack` rewrites workspace:* dependencies to real versions and runs
# each package's prepack build; `npm publish` on the tarball handles auth.
#
# In GitHub Actions the publish authenticates with npm trusted publishing
# (OIDC) and attaches a provenance attestation. Run locally for the one-time
# bootstrap publish that has to happen before trusted publishing can be
# configured for a package: it then uses your `npm login` session and skips
# provenance, which is only available from a CI runner.
#
# NOTE: `npm view` is unauthenticated in CI, so while a package is published
# with restricted access an existing version looks unpublished here and
# `npm publish` fails on the conflict instead of being skipped.
set -euo pipefail

tag=${1:?usage: scripts/publish.sh <dist-tag>}
repo_root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

packages=(packages/node)

provenance=()
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  provenance=(--provenance)
fi

for dir in "${packages[@]}"; do
  name=$(node -p "require('$repo_root/$dir/package.json').name")
  version=$(node -p "require('$repo_root/$dir/package.json').version")
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "$name@$version already published — skipping"
    continue
  fi
  tarball="$tmp/$(basename "$dir").tgz"
  (cd "$repo_root/$dir" && pnpm pack --out "$tarball")
  npm publish "$tarball" --tag "$tag" ${provenance[@]+"${provenance[@]}"}
done
