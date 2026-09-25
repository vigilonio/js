# Contributing

This repository is a pnpm workspace. Each SDK package lives under `packages/`, and new framework- and runtime-specific packages are added there alongside `@vigilon/node`.

## Development

```bash
pnpm install
pnpm build   # builds all packages in dependency order
pnpm test    # runs each package's vitest suite
pnpm smoke   # packs the packages and installs them into a throwaway project
```

## Releasing

All packages version and release in lockstep. On every push to `main`, the `Release Main` workflow (`.github/workflows/release-main.yml`) bumps the patch version of every package, tags the release, and publishes to npm with provenance; PRs publish `-beta.pr-*` versions via `.github/workflows/pr-beta.yml`. Publishing uses npm trusted publishing (OIDC), so each package needs this repository's workflows configured as a trusted publisher on npmjs.com.
