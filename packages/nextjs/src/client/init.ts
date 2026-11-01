import { type BrowserEvent, init as initBrowser, type VigilonBrowserOptions } from "@vigilon/react";

/**
 * Starts error monitoring in the browser, as @vigilon/browser's init() does.
 * With `withVigilon()` in next.config, Next.js renders the trace ID of the
 * request that rendered the page in a `traceparent` meta tag; every event
 * captured before the first client-side navigation carries it, so a hydration
 * or early render error links to its server trace.
 */
export function init(options: VigilonBrowserOptions): boolean {
  const serverTrace = readServerTrace();
  if (serverTrace === null) {
    return initBrowser(options);
  }
  const { beforeSend } = options;
  return initBrowser({
    ...options,
    beforeSend: (event) => {
      const linked = linkServerTrace(event, serverTrace);
      return beforeSend ? beforeSend(linked) : linked;
    },
  });
}

interface ServerTrace {
  traceId: string;
  /** The page URL the server rendered, without its fragment. */
  url: string;
}

function readServerTrace(): ServerTrace | null {
  if (typeof document === "undefined") {
    return null;
  }
  const content = document.querySelector('meta[name="traceparent"]')?.getAttribute("content");
  // W3C traceparent: version-traceid-parentid-flags.
  const traceId = content?.split("-")[1];
  if (!traceId || !/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) {
    return null;
  }
  return { traceId, url: withoutFragment(window.location.href) };
}

/**
 * The trace belongs to the request that rendered the page, so it applies only
 * while the browser is still on that page's URL.
 */
export function linkServerTrace(event: BrowserEvent, serverTrace: ServerTrace): BrowserEvent {
  if (event.traceId || withoutFragment(String(event.page.url)) !== serverTrace.url) {
    return event;
  }
  return { ...event, traceId: serverTrace.traceId };
}

function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}
