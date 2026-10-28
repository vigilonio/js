# `@vigilon/browser`

Error monitoring for browser applications. Captures uncaught errors and unhandled promise rejections, and errors you report yourself, and sends them to [Vigilon](https://vigilon.io), where they appear on the Errors page as Error Groups with origin `browser`.

> **Early access.** Browser error monitoring is not yet generally available. The ingest endpoint accepts events only from projects enabled for early access and answers `403` for the rest, which the SDK does not retry.

Zero dependencies, about 5 KB gzipped, and no side effects on import.

## Install

```bash
npm install @vigilon/browser
```

Or load the script-tag build, which exposes `window.Vigilon`:

```html
<script src="https://unpkg.com/@vigilon/browser@0/dist/vigilon.min.js" crossorigin="anonymous"></script>
```

Pin an exact version (`@vigilon/browser@0.2.8`) in production so a release never changes your page without a deploy.

## Quick start

Create an API key in the [Vigilon dashboard](https://app.vigilon.io) under your project's **Settings** page, **API Keys** tab. Call `init` once, as early as possible in your app's entry point:

```ts
import { init } from "@vigilon/browser";

init({
  apiKey: "your-api-key",
  serviceName: "dashboard",
  environment: "production",
  serviceVersion: "2026.10.26-1",
});
```

The API key ships to every visitor's browser, so treat it as public: it can only send telemetry to its project.

`init` returns `false` and logs the reason when it cannot start. During server-side rendering there is no `window`, so `init` and every other function are safe no-ops; you can import the package from code that runs on both sides.

Set `serviceVersion` to your release (a build number or commit SHA). Without it, Vigilon cannot tell which release introduced an error, and the SDK warns once.

## Reporting errors yourself

```ts
import { captureException, setTag, setUser } from "@vigilon/browser";

try {
  await saveSettings();
} catch (error) {
  captureException(error); // returns the event ID, or null when it was not sent
}

setUser({ id: "user_8f2c" }); // an opaque ID; never an email address
setTag("plan", "pro");
```

`captureException` accepts any thrown value. Non-`Error` values are recorded with their string or JSON form as the message, and an error's `cause` chain is captured up to five levels.

## Configuration

| Option | Default | |
|---|---|---|
| `apiKey` | required | A project API key. |
| `serviceName` | required | The Service this app reports as: 1 to 100 letters, digits, and `. _ : / -`. |
| `environment` | required | The deployment environment, with the same character set. |
| `serviceVersion` | none | The release. |
| `endpoint` | `https://ingest.vigilon.io` | The ingest base URL. |
| `ignoreErrors` | see below | More errors to drop, as strings (substring match) or regular expressions, matched against the message and against `type: message`. |
| `denyUrls` | see below | More script URLs whose errors are dropped. |
| `beforeSend` | none | `(event) => event \| null`. Edit or drop each event before it is sent. |
| `sampleRate` | `1` | The fraction of errors to send. |
| `maxEventsPerPage` | `100` | At most this many events per page load. |
| `debug` | `false` | Log SDK diagnostics to the console. |

Some noise is dropped by default: `Script error.` (an opaque error from a cross-origin script), failed and aborted network requests (`Failed to fetch`, `NetworkError when attempting to fetch resource`, `Load failed`, `AbortError`), `ResizeObserver loop` warnings, and errors thrown by browser extensions. The same error repeating within a minute is sent once, so an error loop cannot flood your project.

`flush()` sends queued events now and `close()` flushes and stops capturing. Both resolve `true` when everything was sent.

## Readable stack traces

Production scripts are minified, so a raw stack trace points at minified code. [`@vigilon/bundler-plugins`](../bundler-plugins#readme) gives each script your build emits a debug ID that links it to its source map. The SDK sends the debug IDs of the scripts in an error's stack with the error, reading them from the runtime registries that build tools write: `_vigilonDebugIds`, then `_sentryDebugIds` and `_debugIds`. A build that already injects debug IDs for Sentry needs no second pass.

## Privacy

The SDK removes the query string, the fragment, and any `user:password@` from the page URL and from every URL in a stack trace. It drops tags whose key looks like a credential (`password`, `token`, `secret`, `authorization`, `cookie`, and similar), and a `setUser` ID that looks like an email address. The session ID is a random value in `sessionStorage`, one per tab; the SDK sets no cookies. Vigilon applies the same rules again on its side.

**Error messages are sent as they are.** A message is free text, so it can contain whatever your code put in it, and Vigilon cannot scrub it reliably. If your messages can carry personal data, scrub them in `beforeSend`:

```ts
init({
  // ...
  beforeSend(event) {
    event.exception.message = event.exception.message.replace(/\S+@\S+/g, "[email]");
    return event;
  },
});
```

## Delivery

Events are batched and sent with `fetch`. When the page is hidden or unloaded, queued events are sent with `keepalive` so they outlive the page. The SDK retries a request only when the endpoint is rate limiting (`429`), temporarily unavailable (`503`), or unreachable, and honours `Retry-After` by pausing all sends. It gives up on an event after five attempts or 30 minutes after its first attempt.

Delivery is **at-least-once with duplicate suppression inside a one-hour window**, not exactly-once: a retry after an ambiguous network failure is recognised and counted once if it arrives within an hour.

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/vigilonio/js/issues)
- Security vulnerabilities: report them privately to [security@vigilon.io](mailto:security@vigilon.io)
