# `@vigilon/browser`

Error monitoring for browser applications. Captures uncaught errors and unhandled promise rejections, and errors you report yourself, and sends them to [Vigilon](https://vigilon.io), where they appear on the Errors page as Error Groups with origin `browser`.

Zero dependencies, about 7 KB gzipped, and no side effects on import.

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

In the [Vigilon dashboard](https://app.vigilon.io), open your project's **Settings** page, then the **API Keys** tab, and create a key of kind `Browser`.

Under **Allowed origins**, you can list the origins your app is served from, one per line, such as `https://app.example.com`. `https://*.example.com` covers every subdomain of `example.com`. Vigilon then answers requests from any other origin with HTTP `403`, so a key copied into another site is refused. An empty list accepts any origin. To report from local development, add your dev server's origin, such as `http://localhost:5173`, or create a second key for it.

Call `init` once, as early as possible in your app's entry point:

```ts
import { init } from "@vigilon/browser";

init({
  apiKey: "your-api-key",
  serviceName: "dashboard",
  environment: "production",
  serviceVersion: "2026.10.26-1",
});
```

The key ships to every visitor's browser, so treat it as public: a `Browser` key can only send browser errors to its project, and Vigilon refuses it for traces and metrics. Never put a `Server` key in browser code.

If your entry point imports the rest of your app, put `init` in a module of its own and import that first: imports run before the importing module's own code, so errors thrown while they load would otherwise be missed.

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

## Pages

Vigilon groups an error's affected pages by route template, such as `/users/:id`, so a page with IDs in its URL still counts as one page. Without a template it derives one from the URL path, replacing segments that look like IDs. If your router knows the template, set it on every navigation:

```ts
import { setRoute } from "@vigilon/browser";

setRoute("/users/:id"); // the template, never the URL; pass null to clear it
```

`@vigilon/react` does this for TanStack Router and React Router.

## Breadcrumbs

Each error carries the breadcrumbs recorded before it, the 50 most recent, so you can see what led up to it:

- **navigation**: path changes through the History API, as `from` and `to` paths;
- **click**: the clicked element as a selector, such as `button#save.btn.primary` (tag, id, and up to two classes; never the element's text);
- **console**: `console.warn` and `console.error` calls, as their first argument only (an object loses keys that look like a credential);
- **fetch** and **xhr**: the method, the URL without its query string or fragment, the status (`0` when the request failed), and the duration. Requests the SDK sends to Vigilon are never recorded.

Add your own steps with `addBreadcrumb`:

```ts
import { addBreadcrumb } from "@vigilon/browser";

addBreadcrumb({ message: "checkout started", data: { step: 1 } });
```

Turn sources off, or record more console levels, with the `breadcrumbs` option, and edit or drop single breadcrumbs with `beforeBreadcrumb`:

```ts
init({
  // ...
  breadcrumbs: { console: ["log", "warn", "error"], xhr: false },
  beforeBreadcrumb(breadcrumb) {
    return breadcrumb.category === "click" ? null : breadcrumb;
  },
});
```

## Configuration

| Option | Default | |
|---|---|---|
| `apiKey` | required | A project API key of kind `Browser`. |
| `serviceName` | required | The Service this app reports as: 1 to 100 letters, digits, and `. _ : / -`. |
| `environment` | required | The deployment environment, with the same character set. |
| `serviceVersion` | none | The release. |
| `endpoint` | `https://ingest.vigilon.io` | The ingest base URL. |
| `ignoreErrors` | see below | More errors to drop, as strings (substring match) or regular expressions, matched against the message and against `type: message`. |
| `denyUrls` | see below | More script URLs whose errors are dropped. |
| `beforeSend` | none | `(event) => event \| null`. Edit or drop each event before it is sent. |
| `breadcrumbs` | all on | `false` turns automatic breadcrumbs off (`addBreadcrumb` still works), or an object turning off `navigation`, `click`, `fetch`, or `xhr`. `console` takes `true` (every level), `false`, or a list of levels; the default is `["warn", "error"]`. |
| `beforeBreadcrumb` | none | `(breadcrumb) => breadcrumb \| null`. Edit or drop each breadcrumb as it is recorded. |
| `sampleRate` | `1` | The fraction of errors to send. |
| `maxEventsPerPage` | `100` | At most this many events per page load. |
| `debug` | `false` | Log SDK diagnostics to the console. |

Some noise is dropped by default: `Script error.` (an opaque error from a cross-origin script), failed and aborted network requests (`Failed to fetch`, `NetworkError when attempting to fetch resource`, `Load failed`, `AbortError`), `ResizeObserver loop` warnings, and errors thrown by browser extensions. The same error repeating within a minute is sent once, so an error loop cannot flood your project.

`flush()` sends queued events now and `close()` flushes and stops capturing. Both resolve `true` when everything was sent.

## Readable stack traces

Production scripts are minified, so a raw stack trace points at minified code. [`@vigilon/bundler-plugins`](../bundler-plugins#readme) gives each script your build emits a debug ID that links it to its source map. The SDK sends the debug IDs of the scripts in an error's stack with the error, reading them from the runtime registries that build tools write: `_vigilonDebugIds`, then `_sentryDebugIds` and `_debugIds`. A build that already injects debug IDs for Sentry needs no second pass.

## Privacy

The SDK removes the query string, the fragment, and any `user:password@` from the page URL and from every URL in a stack trace. It drops tags whose key looks like a credential (`password`, `token`, `secret`, `authorization`, `cookie`, and similar), and a `setUser` ID that looks like an email address. The session ID is a random value in `sessionStorage`, one per tab; the SDK sets no cookies. In breadcrumbs it removes the query string, the fragment, and `user:password@` from every URL and path, drops data keys that look like a credential, records clicks without the element's text, and keeps console breadcrumbs to the first argument of warnings and errors unless you ask for more levels. Vigilon applies the same rules again on its side.

**Error messages are sent as they are**, and so are console messages in breadcrumbs, apart from their URLs. A message is free text, so it can contain whatever your code put in it, and Vigilon cannot scrub it reliably. If your messages can carry personal data, scrub them in `beforeSend` (and console breadcrumbs in `beforeBreadcrumb`). The message is also the first line of the stack, and each entry of `cause` carries its own message and stack, so scrub all of them. Keep the pattern away from the stack's script URLs: Vigilon reads the frames from them.

```ts
// Email addresses, but not the @ in a script URL such as /@scope/package@1.2.3/.
const scrub = (text: string) =>
  text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");

init({
  // ...
  beforeSend(event) {
    const { exception } = event;
    exception.message = scrub(exception.message);
    if (exception.stack) exception.stack = scrub(exception.stack);
    for (const cause of exception.cause ?? []) {
      cause.message = scrub(cause.message);
      if (cause.stack) cause.stack = scrub(cause.stack);
    }
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
