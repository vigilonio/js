# `@vigilon/nextjs`

Vigilon for Next.js: server traces and errors from the Node.js runtime, and browser errors from the client, reported under one service. It wraps [`@vigilon/node`](../node#readme) on the server and [`@vigilon/react`](../react#readme) in the browser.

Requires Next.js 15.3 or later, and Node.js 22.12 or later for the build and the server. Automatic source map upload needs Next.js 15.4 or later.

## Install

```bash
npm install @vigilon/nextjs
```

## Set up

### API keys

In the [Vigilon dashboard](https://app.vigilon.io), open your project's **Settings** page, then the **API Keys** tab, and create two keys:

- one of kind `Server` for the Node.js runtime, set as `VIGILON_API_KEY`;
- one of kind `Browser` for the client, set as `NEXT_PUBLIC_VIGILON_API_KEY`.

Under the browser key's **Allowed origins**, you can list your site's origins, one per line; `https://*.example.com` covers every subdomain, and an empty list accepts any origin. Requests from any other origin get HTTP `403`. The browser key is built into your client JavaScript, where anyone can read it, so never use the server key there.

### `next.config.ts`

```ts
import { withVigilon } from "@vigilon/nextjs/config";

export default withVigilon({
  // your Next.js config
});
```

`withVigilon()` keeps the SDK and its OpenTelemetry dependencies out of the server bundle, and has Next.js render the request's `traceparent` in a meta tag so browser errors on a server-rendered page link to the server trace that rendered it.

### `instrumentation.ts` (server)

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { register } = await import("@vigilon/nextjs/server");
    register({ serviceName: "storefront", serviceVersion: process.env.VIGILON_SERVICE_VERSION });
  }
}
```

`register()` takes the same options as [`@vigilon/node`](../node#readme) and reads anything you leave out from the environment (`VIGILON_API_KEY`, `VIGILON_ENVIRONMENT`, …). It adds what Next.js needs on top: request spans are labelled with the route Next.js resolved (`/api/orders/[id]`), and on Vercel telemetry is flushed at the end of every request and the real response status is recorded. The SDK cannot run in the Edge runtime, so gate on `NEXT_RUNTIME` and import it dynamically as above.

Next.js records errors from Server Components, route handlers, and Server Actions on its own request spans, so no `onRequestError` hook is needed. Everything from `@vigilon/node` (`recordException`, `withJobMonitor`, …) is re-exported from `@vigilon/nextjs/server`.

### `instrumentation-client.ts` (browser)

```ts
import { init } from "@vigilon/nextjs";

init({
  apiKey: process.env.NEXT_PUBLIC_VIGILON_API_KEY!,
  serviceName: "storefront",
  environment: process.env.NEXT_PUBLIC_VIGILON_ENVIRONMENT!,
  serviceVersion: process.env.NEXT_PUBLIC_VIGILON_SERVICE_VERSION,
});
```

Use the same `serviceName` as the server: Vigilon keeps server and browser errors apart by origin. `init` takes the options of [`@vigilon/browser`](../browser#readme). Every event captured before the first client-side navigation carries the trace ID of the request that rendered the page.

### Error boundaries

Next.js creates the React root itself, so render errors that an `error.tsx` or `global-error.tsx` boundary catches are reported from the boundary:

```tsx
"use client";
import { useReportError } from "@vigilon/nextjs";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useReportError(error);
  return (
    <html lang="en">
      <body>
        <h2>Something went wrong.</h2>
      </body>
    </html>
  );
}
```

Errors thrown on the server, in a Server Component or a Server Action, reach these boundaries with their message redacted and a `digest`. Next.js already records them on the server, so `useReportError` skips any error that has a `digest` rather than reporting the redacted copy again.

`@vigilon/nextjs` re-exports `@vigilon/react`, including `ErrorBoundary` for your own boundaries inside client components.

## Source maps

With a source map upload token, `withVigilon()` builds browser source maps and, once Next.js has compiled, gives every script a debug ID, uploads the scripts and their maps, and deletes every map so none is deployed. Before that it marks, in each map's `ignoreList`, the sources that are not files in your project, such as the precompiled Next.js code a webpack build maps, so Vigilon treats their frames as library code rather than yours. Files outside the project directory that exist on disk, such as a shared package in a monorepo, stay yours. It runs in Next.js's `compiler.runAfterProductionCompile` hook (Next.js 15.4 or later), so it works with both Turbopack and webpack.

Create the upload token on your project's **Settings** page, **Source Maps** tab, and set it as `VIGILON_SOURCE_MAP_TOKEN` where `next build` runs, such as a CI secret. Never give it a `NEXT_PUBLIC_` name: anyone with it can replace your source maps.

```bash
VIGILON_SOURCE_MAP_TOKEN=vg_sm_... next build
```

| Option | Default | |
|---|---|---|
| `uploadToken` | `VIGILON_SOURCE_MAP_TOKEN` | A source map upload token for the project, starting with `vg_sm_`. Without one, no source maps are built or uploaded. An API key does not work here. |
| `apiUrl` | `VIGILON_API_URL`, then `https://api.vigilon.io` | The Vigilon API. |
| `onUploadError` | `"error"` | `"warn"` keeps a failed upload from failing the build. The maps are deleted either way. |

```ts
export default withVigilon(nextConfig, { onUploadError: "warn" });
```

On Next.js 15.3, run [`@vigilon/cli`](../cli#readme) on `.next/static` after `next build` instead, with `productionBrowserSourceMaps: true`.

## Self-hosted Next.js (optional)

With `next start` or the standalone output you can preload the SDK instead of, or as well as, registering it from `instrumentation.ts`, which adds Vigilon's own HTTP server spans:

```bash
NODE_OPTIONS='--import @vigilon/nextjs/register' next start
```

The preload reads its settings from the environment. Preload this package's entry, not `@vigilon/node/register`: a plain `@vigilon/node` start has no Next.js route labelling, and `register()` from this package then warns and does nothing. Preloading does not work on Vercel; use `instrumentation.ts` there.

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/vigilonio/js/issues)
- Security vulnerabilities: report them privately to [security@vigilon.io](mailto:security@vigilon.io)
