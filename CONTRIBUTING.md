# Contributing

This repository is a pnpm workspace. Each SDK package lives under `packages/`, and new framework- and runtime-specific packages are added there alongside `@vigilon/node`.

## Development

```bash
pnpm install
pnpm build   # builds all packages in dependency order
pnpm test    # runs each package's vitest suite
pnpm smoke   # packs the packages and installs them into a throwaway project
```

`@vigilon/browser` has two more checks, both run in CI:

```bash
pnpm --filter @vigilon/browser size             # gzip size budget (8 KB)
pnpm --filter @vigilon/browser test:transport   # Playwright, after `pnpm build`
```

The transport test needs Playwright's Chromium, Firefox, and WebKit: `pnpm --filter @vigilon/browser exec playwright install chromium firefox webkit`.

`packages/browser/contract/v1` holds the JSON Schema and example envelopes for the request body `@vigilon/browser` sends; see `packages/browser/contract/README.md`.

## Releasing

All packages version and release in lockstep. `scripts/publish.sh` publishes every non-private workspace package, dependencies first (`scripts/workspace-packages.mjs`). A new package needs one bootstrap publish from a maintainer's machine before its trusted publisher can be configured on npmjs.com, as the script's header explains. On every push to `main`, the `Release Main` workflow (`.github/workflows/release-main.yml`) bumps the patch version of every package, tags the release, and publishes to npm with provenance; PRs publish `-beta.pr-*` versions via `.github/workflows/pr-beta.yml`. Publishing uses npm trusted publishing (OIDC), so each package needs this repository's workflows configured as a trusted publisher on npmjs.com.
