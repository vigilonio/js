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
# NOTE: the already-published check uses `npm view`, which only sees public
# versions when run unauthenticated (as in CI). Packages are published with
# public access, so that is sufficient; a restricted version would look
# unpublished here and `npm publish` would then fail on the conflict.
set -euo pipefail

tag=${1:-}
case "$tag" in
  latest | beta) ;;
  *)
    echo "usage: scripts/publish.sh <latest|beta>" >&2
    exit 2
    ;;
esac
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
