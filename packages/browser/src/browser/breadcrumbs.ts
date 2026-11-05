import type { Breadcrumb, BreadcrumbLevel } from "../core/envelope";
import { isDeniedKey } from "../core/privacy";

/*
 * Automatic breadcrumbs: navigations, clicks, console calls, and fetch and XHR
 * requests. Each installer returns a function that undoes it. A wrapper that
 * was wrapped again by someone else is left in place but stops recording.
 */

export type ConsoleLevel = "debug" | "info" | "log" | "warn" | "error";

export type RecordBreadcrumb = (breadcrumb: Omit<Breadcrumb, "timestamp">) => void;

const CONSOLE_LEVELS: Record<ConsoleLevel, BreadcrumbLevel> = {
  debug: "debug",
  info: "info",
  log: "info",
  warn: "warning",
  error: "error",
};

type Restore = () => void;

/** Replaces object[name] with wrap(original); the restore puts it back if it is still ours. */
function patch<T extends object, K extends keyof T>(
  object: T,
  name: K,
  wrap: (original: T[K], active: () => boolean) => T[K],
): Restore {
  const original = object[name];
  if (typeof original !== "function") {
    return () => undefined;
  }
  let active = true;
  const wrapped = wrap(original, () => active);
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  object[name] = wrapped;
  // Some environments define the property as an accessor (window.fetch in
  // some DOM implementations and polyfills), where assignment does not take.
  const defined = object[name] !== wrapped;
  if (defined) {
    Object.defineProperty(object, name, { configurable: true, writable: true, value: wrapped });
  }
  return () => {
    active = false;
    if (object[name] !== wrapped) {
      return;
    }
    if (!defined) {
      object[name] = original;
    } else if (descriptor) {
      Object.defineProperty(object, name, descriptor);
    } else {
      delete object[name];
    }
  };
}

/** Records path changes from history.pushState, replaceState, and popstate. */
export function instrumentNavigation(record: RecordBreadcrumb): Restore {
  let last = window.location.pathname;
  const onChange = () => {
    const to = window.location.pathname;
    if (to !== last) {
      record({ category: "navigation", data: { from: last, to } });
      last = to;
    }
  };
  const restores = (["pushState", "replaceState"] as const).map((name) =>
    patch(window.history, name, (original, active) =>
      function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        if (active()) {
          onChange();
        }
        return result;
      },
    ),
  );
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    for (const restore of restores) {
      restore();
    }
  };
}

/** Records clicks as an element selector: tag, id, and up to two classes, never text. */
export function instrumentClicks(record: RecordBreadcrumb): Restore {
  const onClick = (event: Event) => {
    const selector = selectorOf(event.target);
    if (selector !== null) {
      record({ category: "click", message: selector });
    }
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

export function selectorOf(target: EventTarget | null): string | null {
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return null;
  }
  let selector = target.tagName.toLowerCase();
  if (target.id) {
    selector += `#${target.id}`;
  }
  const classes = Array.from(target.classList).slice(0, 2);
  for (const name of classes) {
    selector += `.${name}`;
  }
  return selector;
}

/**
 * Records calls to the given console methods as their first argument only:
 * later arguments are often the objects that carry user data. The SDK's own
 * diagnostics are skipped.
 */
export function instrumentConsole(record: RecordBreadcrumb, levels: ConsoleLevel[]): Restore {
  const restores = levels
    .filter((level) => level in CONSOLE_LEVELS)
    .map((level) =>
      patch(console, level, (original, active) =>
        function (this: Console, ...args: unknown[]) {
          if (active() && !(typeof args[0] === "string" && args[0].startsWith("[Vigilon]"))) {
            try {
              record({
                category: "console",
                level: CONSOLE_LEVELS[level],
                message: describe(args[0]),
              });
            } catch {
              // A breadcrumb must never break the application's logging.
            }
          }
          return original.apply(this, args);
        },
      ),
    );
  return () => {
    for (const restore of restores) {
      restore();
    }
  };
}

function describe(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    // Keys that look like a credential are left out, as in tags and data.
    const json = JSON.stringify(value, (key, item: unknown) =>
      key !== "" && isDeniedKey(key) ? undefined : item,
    );
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function requestLevel(status: number): BreadcrumbLevel | undefined {
  if (status === 0 || status >= 500) {
    return "error";
  }
  return status >= 400 ? "warning" : undefined;
}

function recordRequest(
  record: RecordBreadcrumb,
  category: "fetch" | "xhr",
  method: string,
  url: string,
  status: number,
  startedAt: number,
): void {
  const level = requestLevel(status);
  record({
    category,
    ...(level ? { level } : {}),
    data: {
      method: method.toUpperCase(),
      url,
      status_code: status,
      duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
    },
  });
}

/** Records fetch requests. Requests the SDK itself sends (isOwnRequest) are skipped. */
export function instrumentFetch(
  record: RecordBreadcrumb,
  isOwnRequest: (url: string) => boolean,
): Restore {
  return patch(window, "fetch", (original, active) =>
    function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const call = () => original.call(window, input, init);
      let url: string;
      let method: string;
      try {
        url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
      } catch {
        return call();
      }
      if (!active() || isOwnRequest(url)) {
        return call();
      }
      const startedAt = Date.now();
      return call().then(
        (response) => {
          recordRequest(record, "fetch", method, url, response.status, startedAt);
          return response;
        },
        (error: unknown) => {
          recordRequest(record, "fetch", method, url, 0, startedAt);
          throw error;
        },
      );
    } as typeof fetch,
  );
}

/** Records XMLHttpRequest requests. Requests the SDK itself sends are skipped. */
export function instrumentXhr(
  record: RecordBreadcrumb,
  isOwnRequest: (url: string) => boolean,
): Restore {
  if (typeof XMLHttpRequest === "undefined") {
    return () => undefined;
  }
  type Pending = { method: string; url: string; startedAt: number | null; recorded: boolean };
  const requests = new WeakMap<XMLHttpRequest, Pending>();
  const listening = new WeakSet<XMLHttpRequest>();
  // Records a request once, at readystatechange to DONE, which fires before
  // load and loadend.
  const complete = (xhr: XMLHttpRequest) => {
    const request = requests.get(xhr);
    if (xhr.readyState === 4 && request && request.startedAt !== null && !request.recorded) {
      request.recorded = true;
      recordRequest(record, "xhr", request.method, request.url, xhr.status, request.startedAt);
    }
  };
  const prototype = XMLHttpRequest.prototype;
  const restoreOpen = patch(prototype, "open", (original, active) =>
    function (this: XMLHttpRequest, ...args: unknown[]) {
      if (active()) {
        requests.set(this, { method: String(args[0]), url: String(args[1]), startedAt: null, recorded: false });
        // Listening from open() puts the breadcrumb ahead of handlers added
        // after it, which is where libraries add theirs.
        if (!listening.has(this)) {
          listening.add(this);
          this.addEventListener("readystatechange", () => complete(this));
        }
      }
      return (original as (...rest: unknown[]) => void).apply(this, args);
    } as XMLHttpRequest["open"],
  );
  const restoreSend = patch(prototype, "send", (original, active) =>
    function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const request = requests.get(this);
      if (active() && request && !isOwnRequest(request.url)) {
        request.startedAt = Date.now();
        // An onreadystatechange handler assigned before open() would still
        // run first, so it is wrapped to record the request before it runs.
        // A listener added with addEventListener before open() is not.
        const handler = this.onreadystatechange;
        if (typeof handler === "function") {
          const xhr = this;
          this.onreadystatechange = function (this: XMLHttpRequest, event: Event) {
            complete(xhr);
            return handler.call(this, event);
          };
        }
      }
      return original.call(this, body);
    },
  );
  return () => {
    restoreOpen();
    restoreSend();
  };
}
