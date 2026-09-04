# `@vigilon/node`

Vigilon provides OpenTelemetry bootstrap for Node.js apps with a preload entrypoint that starts instrumentation before your application code runs.

## Install

```bash
npm install @vigilon/node
```

Requires Node.js 20.6 or later.

## Required Environment Variables

Set these before starting your app:

```bash
VIGILON_API_KEY=your-api-key
VIGILON_SERVICE_NAME=your-service-name
VIGILON_ENVIRONMENT=production
```

Recommended:

```bash
VIGILON_SERVICE_VERSION=1.2.3
```

`VIGILON_SERVICE_VERSION` is optional, but Vigilon will warn if it is missing because deployment/version data improves change tracking and insights.

The `@vigilon/node/register` preload entrypoint reads those variables and calls `register()` automatically.

Optional:

```bash
VIGILON_OTEL_ENDPOINT=http://localhost:4318
VIGILON_EXCLUDED_URLS=/metrics,/internal/status
```

`VIGILON_OTEL_ENDPOINT` overrides the base OTLP HTTP endpoint (default: `https://ingest.vigilon.io`). Vigilon sends traces to `<endpoint>/v1/traces`; Vigilon's endpoint metrics are derived from those traces in the OpenTelemetry Collector.

`VIGILON_EXCLUDED_URLS` is a comma-separated list of additional incoming request URLs to exclude when using the preload entrypoint. Values are trimmed and matched exactly against `req.url`, including any query string. The built-in exclusions (`/health`, `/ready`, and `/favicon.ico`) always apply.

## What Gets Instrumented

Vigilon registers these OpenTelemetry instrumentations automatically:

| Library | Notes |
|---|---|
| `http` / `https` | Incoming requests become server spans; outgoing requests become client spans. Built-in exclusions: `/health`, `/ready`, `/favicon.ico`. |
| `fetch` / `undici` | Outgoing requests made with the global `fetch` or `undici`. |
| Express | Route and middleware spans, and the route template on the server span. |
| Fastify | Route and hook spans; the plugin is registered on every Fastify instance automatically. |
| PostgreSQL (`pg`) | Query spans. |
| MySQL (`mysql`) | Query spans. |
| MongoDB | Command spans. |
| Redis | Command spans. |
| AWS Lambda | Enabled only inside the Lambda runtime; see [AWS Lambda](#aws-lambda). |

Vigilon exports traces only. It does not export OpenTelemetry metrics or logs; endpoint and job metrics are derived from the exported spans on the Vigilon side.

## CommonJS

For CommonJS apps, preload Vigilon with `--require`:

```bash
node --require @vigilon/node/register server.js
```

Example `package.json` script:

```json
{
  "scripts": {
    "start": "node --require @vigilon/node/register server.js"
  }
}
```

## ESM

For ESM apps, preload Vigilon with `--import`:

```bash
node --import @vigilon/node/register server.mjs
```

Example `package.json` script:

```json
{
  "scripts": {
    "start": "node --import @vigilon/node/register server.mjs"
  }
}
```

The ESM preload also registers OpenTelemetry's module loader hook, so ESM imports of instrumented libraries (for example `import express from "express"`) are traced the same way `require()` calls are. No extra loader flags are needed.

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
calls share the first shutdown attempt. Call it only when the process is ready
to stop, after all monitored work has settled, and await it before calling
`process.exit()`.

## Next Steps

If you need to initialize Vigilon manually instead of preloading it, import the main package and call `register()` yourself. To reuse the preload's environment-variable configuration without preloading, call `registerFromEnv()` instead.

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
