# `@vigilon/react`

Error monitoring for React applications. Everything in [`@vigilon/browser`](../browser#readme), plus what React needs: an error boundary, the React 19 root error handlers, and route templates from TanStack Router and React Router.

> **Early access.** Browser error monitoring is not yet generally available. The ingest endpoint accepts events only from projects enabled for early access and answers `403` for the rest, which the SDK does not retry.

## Install

```bash
npm install @vigilon/react
```

Install only this package: it re-exports the `@vigilon/browser` API and pins the matching version. Requires React 18 or later; reporting uncaught and caught render errors through the root error handlers needs React 19.

## Set up

Call `init` once, before the first render, then pass the root error handlers to `createRoot` (or `hydrateRoot`):

```tsx
import { init, rootErrorHandlers } from "@vigilon/react";
import { createRoot } from "react-dom/client";

init({
  apiKey: "your-api-key",
  serviceName: "dashboard",
  environment: "production",
  serviceVersion: "2026.10.31-1",
});

createRoot(document.getElementById("root")!, rootErrorHandlers()).render(<App />);
```

React 19 reports render errors through these root options rather than the window `error` event, so without them Vigilon does not see:

- errors that no error boundary catches (`react_uncaught`),
- errors an error boundary catches, including your router's (`react_error_boundary`),
- errors React recovers from, such as hydration mismatches (`react_recoverable`).

Each handler reports the error, then calls your own callback for that option if you pass one, or logs the error with `console.error` as React would:

```tsx
createRoot(container, rootErrorHandlers({
  onCaughtError: (error, errorInfo) => myLogger.warn(error, errorInfo.componentStack),
}));
```

React 18 has only `onRecoverableError`, so wrap a React 18 app in an `ErrorBoundary` to report render errors.

## Error boundary

`ErrorBoundary` reports errors thrown while rendering its children, with their component stack, and renders `fallback` in their place:

```tsx
import { ErrorBoundary } from "@vigilon/react";

<ErrorBoundary
  fallback={({ error, eventId, resetError }) => (
    <div role="alert">
      <p>Something went wrong.</p>
      <button onClick={resetError}>Try again</button>
    </div>
  )}
>
  <Invoices />
</ErrorBoundary>
```

| Prop | |
|---|---|
| `fallback` | What to render after an error: a node, or a function that receives `error`, `componentStack`, `eventId`, and `resetError`. Defaults to nothing. |
| `onError` | Called with the error, its component stack, and the Vigilon event ID once the error is reported. |
| `onReset` | Called when `resetError` clears the boundary. |

An error is reported once even when both the boundary and the root handlers see it. The package is marked `"use client"`, so the boundary works in frameworks that render on the server by default.

## Pages

Vigilon groups an error's affected pages by route template, such as `/users/:id`. With a supported router, track it once after creating the router, and every error carries the template of the page it happened on:

```ts
// TanStack Router
import { trackTanStackRouter } from "@vigilon/react/tanstack-router";

const router = createRouter({ routeTree });
trackTanStackRouter(router);
```

```ts
// React Router 6.4+ or 7, with a data router
import { trackReactRouter } from "@vigilon/react/react-router";

const router = createBrowserRouter(routes);
trackReactRouter(router);
```

Both return a function that stops tracking. With TanStack Router the template is set before the destination's loaders run, so a loader error carries the page it was loading. React Router apps that use `<BrowserRouter>` rather than a data router, and other routers, can call `setRoute` themselves on each navigation; without a template, Vigilon derives the page from the URL path.

## Configuration and privacy

`init` takes the same options, and applies the same privacy rules, as [`@vigilon/browser`](../browser#readme).

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/vigilonio/js/issues)
- Security vulnerabilities: report them privately to [security@vigilon.io](mailto:security@vigilon.io)
