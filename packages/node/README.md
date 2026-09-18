# `@vigilon/node`

Vigilon provides OpenTelemetry bootstrap for Node.js apps with a preload entrypoint that starts instrumentation before your application code runs.

## Install

```bash
npm install @vigilon/node
```

Requires Node.js 20.6 or later.

## Quick Start

Create an API key in the [Vigilon dashboard](https://app.vigilon.io) under your project's **Settings** page, **API Keys** tab. Then start your app with the key set and the Vigilon preload:

```bash
VIGILON_API_KEY=your-api-key node --import @vigilon/node/register server.js
```

That is usually all that is needed. The `--import` preload works for both CommonJS and ESM apps and starts instrumentation before your application code runs. The service name and version are read from your `package.json`, and the deployment environment from your `ENVIRONMENT`, `ENV`, or `NODE_ENV` variable (see [Configuration](#configuration) for the exact precedence). On startup Vigilon logs one line showing the values it resolved and where each came from:

```
Vigilon started: service.name=api (package.json), deployment.environment=production (ENVIRONMENT), service.version=1.4.2 (package.json), endpoint=https://ingest.vigilon.io
```

Example `package.json` script:

```json
{
  "scripts": {
    "start": "node --import @vigilon/node/register server.js"
  }
}
```

If you cannot change the start command (a Docker base image, PM2, AWS Lambda), preload through `NODE_OPTIONS` instead:

```bash
NODE_OPTIONS="--import @vigilon/node/register" node server.js
```

### Loading a `.env` file

The preload runs before your app, so variables loaded by `dotenv` from inside your code are not visible to it. Use Node's built-in `--env-file` flag to load them first:

```bash
node --env-file=.env --import @vigilon/node/register server.js
```

## Configuration

Vigilon reads its configuration from, in order of priority, arguments passed to `register()`, environment variables, and the nearest `package.json`. Blank and whitespace-only values are ignored. The first source that provides a value wins.

| Setting | Sources, highest priority first | Required |
|---|---|---|
| API key | `VIGILON_API_KEY` | Yes |
| Service name (`service.name`) | `VIGILON_SERVICE_NAME`, `OTEL_SERVICE_NAME`, `npm_package_name`, `AWS_LAMBDA_FUNCTION_NAME`, `package.json` `"name"` | Yes |
| Environment (`deployment.environment`) | `VIGILON_ENVIRONMENT`, `ENVIRONMENT`, `ENV`, `NODE_ENV` | Yes |
| Service version (`service.version`) | `VIGILON_SERVICE_VERSION`, `npm_package_version`, `package.json` `"version"` | No, but recommended |
| OTLP endpoint | `VIGILON_OTEL_ENDPOINT` | No, defaults to `https://ingest.vigilon.io` |
| Excluded URLs | `VIGILON_EXCLUDED_URLS` | No |

If the API key, service name, or environment cannot be resolved, Vigilon throws on startup with a message listing every missing setting and the sources it checked. Set the `VIGILON_*` variable named in the message to fix it.

### Service name

`npm_package_name` is set automatically when the app is started through `npm start`, `pnpm start`, or `yarn start`, so most apps need nothing else. When the app is started with a bare `node` command, Vigilon looks for the nearest `package.json` instead: it walks up from the directory of the entry script, then from the working directory, and uses the first `package.json` that declares a non-blank `name` or `version`. That file is the project's manifest for both fields, so a `package.json` with only a `version` supplies the version and leaves the name to be set through `VIGILON_SERVICE_NAME`, and files with neither field (such as a `{"type": "module"}` stub in a build directory) are walked past. Directories inside `node_modules` are skipped, so a tool entry point such as `node_modules/next/dist/bin/next` still resolves to your application's package, and in a monorepo `node packages/api/dist/server.js` resolves to `packages/api/package.json` rather than the repository root.

Scoped names are kept as-is: `@acme/api` is reported as `@acme/api`. Set `VIGILON_SERVICE_NAME` if you want a different name, or if the derived one is wrong (for example a monorepo root package named after the repository).

### Environment

`VIGILON_ENVIRONMENT` always wins. When it is unset, Vigilon falls back to the generic `ENVIRONMENT`, `ENV`, and finally `NODE_ENV` variables. `NODE_ENV` is a last resort because it is usually `production` in staging environments too; check the startup log line if your environment shows up unexpectedly, and set `VIGILON_ENVIRONMENT` explicitly when the generic variables do not describe your deployment.

### Service version

The version is derived from `npm_package_version` or the `package.json` `"version"` field. If your services do not bump that field per deployment, set `VIGILON_SERVICE_VERSION` from your CI or platform's commit identifier (for example `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, or `RAILWAY_GIT_COMMIT_SHA`). Vigilon warns when no version can be resolved at all, because deployment/version data improves change tracking and insights.

### Optional variables

```bash
VIGILON_OTEL_ENDPOINT=http://localhost:4318
VIGILON_EXCLUDED_URLS=/metrics,/internal/status
VIGILON_DISABLED=1
VIGILON_DEBUG=1
```

`VIGILON_OTEL_ENDPOINT` overrides the base OTLP HTTP endpoint (default: `https://ingest.vigilon.io`). Vigilon sends traces to `<endpoint>/v1/traces`; Vigilon's endpoint metrics are derived from those traces.

`VIGILON_EXCLUDED_URLS` is a comma-separated list of additional incoming request URLs to exclude. Values are trimmed and matched exactly against `req.url`, including any query string. The built-in exclusions (`/health`, `/ready`, and `/favicon.ico`) always apply.

`VIGILON_DISABLED=1` (also `true` or `yes`) turns the SDK into a no-op: the preload and `register()` log a single notice and collect nothing. Use it to run an app locally with the preload still in its start script and no API key at hand.

`VIGILON_DEBUG=1` enables OpenTelemetry's diagnostic logger at debug level, which prints exporter requests, retries, and instrumentation activity.

### Export failures

The OTLP exporter reports failures only through OpenTelemetry's diagnostic logger, which is silent by default. Vigilon adds one console message for the first failed export so a misconfiguration does not show up as an empty dashboard: a rejected API key (HTTP 401 or 403) is reported as such, and any other failure is reported with its error message and a pointer to `VIGILON_DEBUG`.

## CommonJS with `--require`

CommonJS apps can also preload Vigilon with `--require`:

```bash
node --require @vigilon/node/register server.js
```

This only works for CommonJS. For an ESM app `--require` starts the SDK but cannot hook ESM imports, so no request or database spans are produced. Prefer `--import`, which handles both module formats and also registers OpenTelemetry's module loader hook so ESM imports of instrumented libraries (for example `import express from "express"`) are traced the same way `require()` calls are.

## What Gets Instrumented

Vigilon registers these OpenTelemetry instrumentations automatically:

| Library | Notes |
|---|---|
| `http` / `https` | Incoming requests become server spans; outgoing requests become client spans. Built-in exclusions: `/health`, `/ready`, `/favicon.ico`. |
| `fetch` / `undici` | Outgoing requests made with the global `fetch` or `undici`. |
| Express | Route and middleware spans, and the route template on the server span. |
| Fastify | Route and hook spans; the plugin is registered on every Fastify instance automatically. |
| PostgreSQL (`pg`) | Query spans. |
| MySQL (`mysql`, `mysql2`) | Query spans. |
| MongoDB | Command spans. |
| Redis (`redis`, `ioredis`) | Command spans. |
| AWS Lambda | Enabled only inside the Lambda runtime; see [AWS Lambda](#aws-lambda). |

Vigilon exports traces only. It does not export OpenTelemetry metrics or logs; endpoint and job metrics are derived from the exported spans on the Vigilon Ingestion Engine side.

## Background Jobs

Wrap a background job — a cron tick, a queue processor, an interval loop — in `withJobMonitor` to report it as a Job Run in Vigilon. Each call starts its own trace, so database queries and outgoing requests made inside the job are attached to that run instead of being orphaned.

```ts
import { withJobMonitor } from "@vigilon/node";
import cron from "node-cron";

cron.schedule("0 3 * * *", () =>
  withJobMonitor({ name: "sync-users", schedule: "0 3 * * *" }, async () => {
    await syncUsers();
  }),
);
```

`name` is a required, stable identifier for the job. `schedule` is an optional cron expression; when provided, Vigilon can tell you when a job last ran and flag runs that never happened.

The same wrapper works for any job shape:

```ts
// BullMQ — wrap the processor callback
new Worker("emails", (bullJob) =>
  withJobMonitor({ name: "send-email" }, () => sendEmail(bullJob.data)),
);

// Plain interval
setInterval(
  () => withJobMonitor({ name: "refresh-cache" }, () => refreshCache()),
  60_000,
);
```

Sync and async functions are both supported. The return value (or promise) is passed straight through, and errors are recorded on the run and rethrown, so wrapping a job never changes its behaviour.

**Job names must be stable and defined in code.** Never interpolate per-item values — `sync-user-42` creates a brand new job for every user, while `sync-users` correctly accumulates runs over time.

`withJobMonitor` must be called after `register()` has started the SDK. If it runs earlier, the job itself still executes normally, but the run is not reported.

## Short-Lived Processes

One-off scripts, ECS tasks, and other processes that exit after a job finishes
must await `shutdown()` before exiting. OpenTelemetry exports spans in batches,
and Node.js may otherwise exit before the pending batch is sent.

```ts
import { shutdown, withJobMonitor } from "@vigilon/node";

try {
  await withJobMonitor(
    { name: "evaluate-billing-enforcement", schedule: "*/30 * * * *" },
    () => evaluateBillingEnforcement(),
  );
} finally {
  await shutdown();
}
```

This works with both the preload entrypoint and manual `register()` calls.
`shutdown()` is safe before registration and is idempotent: concurrent or later
calls share the first shutdown attempt. It never rejects: if the final flush
fails (for example because the API key was rejected), it logs a warning and
resolves, so a telemetry problem cannot crash your exiting process or mask the
outcome of the job it wraps. Call it only when the process is ready
to stop, after all monitored work has settled, and await it before calling
`process.exit()`.

## Next Steps

If you need to initialize Vigilon manually instead of preloading it, import the main package and call `register()` yourself. Every argument is optional; anything omitted is resolved exactly as described in [Configuration](#configuration), so `register()` with no arguments is equivalent to the preload, and arguments you do pass take priority over the environment and `package.json`. `registerFromEnv()` is kept for compatibility and is the same as calling `register()` with no arguments.

Manual registration must run before your framework and database clients are loaded, because instrumentation patches modules as they are required. In CommonJS that means calling it at the very top of your entry file, before any other `require`. In ESM it is not enough: `import` statements are hoisted and evaluated before your code runs, and only the `--import @vigilon/node/register` preload installs the module loader hook that ESM auto-instrumentation depends on. ESM apps should always use the preload.

```ts
import { register } from "@vigilon/node";

register({
  apiKey: "your-api-key",
  serviceName: "your-service-name",
  environment: "development",
  otelEndpoint: "http://localhost:4318",
  excludedUrls: ["/internal/metrics"],
});
```

`register()` is idempotent. If Vigilon has already been started in the process — for example via the preload entrypoint and an in-process `register()` call — the second call warns and no-ops instead of starting a second SDK.

`excludedUrls` adds incoming request URLs to Vigilon's built-in exclusions (`/health`, `/ready`, and `/favicon.ico`). Values are matched exactly against `req.url`, including any query string. The equivalent preload configuration is `VIGILON_EXCLUDED_URLS`, using comma-separated values.

## Recording Exceptions

Call `recordException(error)` to attach an exception to the current request or job. It records on the active OpenTelemetry span, so it works identically in Express, Fastify, background jobs, and Lambda — no response object required.

```ts
import { recordException } from "@vigilon/node";

app.get("/data", async (req, res) => {
  try {
    res.json(await loadData());
  } catch (error) {
    recordException(error);
    res.status(500).send("Internal Server Error");
  }
});
```

If there is no active span (called outside a traced request or job), `recordException` is a no-op.

## AWS Lambda

Vigilon detects the Lambda runtime via `AWS_LAMBDA_FUNCTION_NAME` and adds the AWS Lambda instrumentation automatically, which flushes traces at the end of each invocation (the container freezes between invocations, so telemetry must be drained before the handler returns). No extra configuration is needed.

If you bundle your Lambda with esbuild (or a similar bundler), keep `@vigilon/node` and its `@opentelemetry/*` dependencies external — bundling them inlines the modules and breaks the require-hook instrumentation that powers auto-instrumentation. Most frameworks expose an "external modules" setting for this (for example SST `nodejs.esbuild.external`, or the serverless-esbuild `external` option).

## Troubleshooting

**No traces show up.** Read the `Vigilon started:` line the SDK prints on startup. If it is missing, the process was not started with the preload (or `VIGILON_DISABLED` is set); if a required setting could not be resolved, the preload throws instead and names the variable to set. If the line is present, look for a `Vigilon: the ingest endpoint rejected the API key` message, which means `VIGILON_API_KEY` is wrong or revoked, or a `Vigilon: exporting traces failed` message, which points at network or endpoint problems. Set `VIGILON_DEBUG=1` for the full OpenTelemetry diagnostics.

**The service name or environment is wrong.** The startup line shows which source each value came from. A monorepo root `package.json`, a leaked `npm_package_name` from a parent npm script, or `NODE_ENV=production` in staging are the usual causes. Set `VIGILON_SERVICE_NAME` or `VIGILON_ENVIRONMENT` explicitly; they always take priority. See [Configuration](#configuration).

**HTTP spans appear but Express, Fastify, or database spans are missing.** The instrumented library was loaded before Vigilon. With the preload this only happens in ESM apps started with `--require` instead of `--import`; with manual registration it happens whenever `register()` runs after the library is imported. See [Next Steps](#next-steps).

**Spans are missing after bundling.** Bundlers such as esbuild inline `@vigilon/node` and its `@opentelemetry/*` dependencies, which bypasses the require hooks. Keep them external; see [AWS Lambda](#aws-lambda).

**"Vigilon is already registered" warning.** The SDK was started twice, usually via both the preload and an in-process `register()` call. Keep one.

**Traces stop when the process exits or is suspended.** Spans are exported in batches. Call `shutdown()` before exiting short-lived processes; see [Short-Lived Processes](#short-lived-processes). AWS Lambda is handled automatically.

**`--import` fails with a `module.register` error.** The preload needs Node.js 20.6 or later.

## Support

- Documentation: [vigilon.io/docs](https://vigilon.io/docs)
- Dashboard: [app.vigilon.io](https://app.vigilon.io)
- Questions and issues: [support@vigilon.io](mailto:support@vigilon.io)
- Security reports: [security@vigilon.io](mailto:security@vigilon.io)
- Privacy policy: [vigilon.io/privacy](https://vigilon.io/privacy)
