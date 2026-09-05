# Vigilon JavaScript SDKs

pnpm workspace housing Vigilon's JavaScript SDK packages, published to npm under the `@vigilon` scope. Product documentation lives at [vigilon.io/docs](https://vigilon.io/docs).

| Package | Use it for |
|---|---|
| [`@vigilon/node`](packages/node/README.md) | Any Node.js app — Express, Fastify, Lambda, plain servers. OpenTelemetry bootstrap with a preload entrypoint. |

The workspace is laid out so additional packages (framework- and runtime-specific SDKs) can be added under `packages/` alongside `@vigilon/node`.

## Development

```bash
pnpm install
pnpm build   # builds all packages in dependency order
pnpm test    # runs each package's vitest suite
pnpm smoke   # packs the packages and installs them into a throwaway project
```

## Releasing

All packages version and release in lockstep. The `Release Main` workflow (`.github/workflows/release-main.yml`) bumps the patch version of every package, tags the release, and publishes to npm with provenance; PRs publish `-beta.pr-*` versions via `.github/workflows/pr-beta.yml`. Publishing uses npm trusted publishing (OIDC), so each package needs this repository's workflows configured as a trusted publisher on npmjs.com.
