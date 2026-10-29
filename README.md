<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/sigil-thin-dark-120.png" />
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/sigil-thin-dark-solid-120.png" />
    <img src=".github/assets/sigil-thin-dark-solid-120.png" alt="Vigilon" width="100" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/vigilonio/js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-ISC-blue.svg" alt="License: ISC"></a>
  <a href="https://www.npmjs.com/org/vigilon"><img src="https://img.shields.io/badge/npm-%40vigilon-cb3837.svg" alt="npm: @vigilon"></a>
</p>

# Vigilon JavaScript SDKs

Official JavaScript and TypeScript SDKs for [Vigilon](https://vigilon.io).

Vigilon is application monitoring for SaaS applications, based on OpenTelemetry. Out of the box it provides RESTful service and endpoint health, error monitoring and alerting, end-to-end tracing, and background job monitoring.

The SDKs set up standard [OpenTelemetry](https://opentelemetry.io/) instrumentation for your runtime and export it to Vigilon over OTLP, with no proprietary agent.

## Packages

Every package lives in `packages/<name>/` and is published to npm under the `@vigilon` scope. All packages share one version number and are released together.

| Package | Version | Description |
|---|---|---|
| [`@vigilon/node`](packages/node) | <a href="https://www.npmjs.com/package/@vigilon/node"><img src="https://img.shields.io/npm/v/@vigilon/node.svg" alt="npm"></a> | Node.js apps: Express, Fastify, AWS Lambda, plain HTTP servers. Starts OpenTelemetry auto-instrumentation through a `--import` preload, so you don't need to change your code. |
| [`@vigilon/browser`](packages/browser) | <a href="https://www.npmjs.com/package/@vigilon/browser"><img src="https://img.shields.io/npm/v/@vigilon/browser.svg" alt="npm"></a> | Browser apps: captures uncaught errors and unhandled rejections. Early access. |
| [`@vigilon/bundler-plugins`](packages/bundler-plugins) | <a href="https://www.npmjs.com/package/@vigilon/bundler-plugins"><img src="https://img.shields.io/npm/v/@vigilon/bundler-plugins.svg" alt="npm"></a> | Vite, Rollup, webpack, and esbuild plugins that link each emitted script to its source map with a debug ID. Early access. |
| [`@vigilon/cli`](packages/cli) | <a href="https://www.npmjs.com/package/@vigilon/cli"><img src="https://img.shields.io/npm/v/@vigilon/cli.svg" alt="npm"></a> | Command line: debug IDs and source map upload for any build output, for CI and other bundlers. Early access. |

## Getting started

1. Create an API key in the [Vigilon dashboard](https://app.vigilon.io) under your project's **Settings** page, **API Keys** tab.
2. Pick the package for your runtime and follow its README to install and set it up:
   - **Node.js**: [`@vigilon/node`](packages/node#readme)
   - **Browser**: [`@vigilon/browser`](packages/browser#readme) (early access)

Full product documentation is at [vigilon.io/docs](https://vigilon.io/docs).

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/vigilonio/js/issues)
- Security vulnerabilities: report them privately to [security@vigilon.io](mailto:security@vigilon.io) instead of opening a public issue.

## Contributing

Build, test, and release instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[ISC](LICENSE)
