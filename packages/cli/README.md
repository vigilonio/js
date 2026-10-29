# `@vigilon/cli`

The Vigilon command line. It links the scripts in any build output to their source maps with debug IDs and uploads them to [Vigilon](https://vigilon.io), so browser errors reported by [`@vigilon/browser`](../browser#readme) can be shown against your original source. Use it in CI, or with a bundler that [`@vigilon/bundler-plugins`](../bundler-plugins#readme) does not cover.

> **Early access.** Source map upload is not available yet. Until it is, `sourcemaps inject` works and `sourcemaps upload` has nowhere to send to.

Requires Node.js 22.12 or later. No dependencies.

## Usage

Run it on the build output, after the build and before you deploy:

```bash
npx @vigilon/cli sourcemaps inject dist
npx @vigilon/cli sourcemaps upload dist --delete-after-upload
```

### `vigilon sourcemaps inject <dir...>`

Gives every script under each directory, and its source map, one debug ID, in place. A script's map is the file its `sourceMappingURL` comment names, or `<script>.map` beside it for hidden source maps. Scripts with no map file are skipped, and `node_modules` is never touched. A script that already has a debug ID, from Sentry's tooling for example, keeps it, so running `inject` twice changes nothing.

Run it on files that are not deployed yet: it changes their contents.

### `vigilon sourcemaps upload <dir...>`

Uploads every script that has a debug ID, with its source map, and waits for Vigilon to verify them. It exits with status 1 when the upload fails or Vigilon reports a script it cannot use.

| Option | Default | Description |
|---|---|---|
| `--token <token>` | `VIGILON_SOURCE_MAP_TOKEN` | A source map upload token for the project. Never use a project API key here: API keys are public in the browser. |
| `--api-url <url>` | `VIGILON_API_URL`, then `https://api.vigilon.io` | The Vigilon API. |
| `--delete-after-upload` | off | Delete the source maps once they are uploaded, so they are never deployed. |
| `--warn-only` | off | Print a warning and exit 0 instead of failing. |

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/vigilonio/js/issues)
- Security vulnerabilities: report them privately to [security@vigilon.io](mailto:security@vigilon.io)
