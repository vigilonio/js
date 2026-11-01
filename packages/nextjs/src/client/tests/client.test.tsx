// @vitest-environment happy-dom
import type { BrowserEvent, VigilonBrowserOptions } from "@vigilon/react";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init, linkServerTrace, useReportError } from "../index";

const { initBrowser, captureException } = vi.hoisted(() => ({
  initBrowser: vi.fn((_options: unknown) => true),
  captureException: vi.fn(),
}));
vi.mock("@vigilon/react", () => ({ init: initBrowser, captureException }));

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const options: VigilonBrowserOptions = { apiKey: "k", serviceName: "web", environment: "test" };

function event(url: string, traceId: string | null = null): BrowserEvent {
  return {
    type: "exception",
    eventId: "e",
    timestamp: "2026-11-01T00:00:00.000Z",
    exception: { type: "Error", message: "m", stack: null, mechanism: "onerror", handled: false },
    page: { url },
    traceId,
  } as BrowserEvent;
}

function setTraceparent(content: string | null): void {
  document.head.querySelector('meta[name="traceparent"]')?.remove();
  if (content !== null) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "traceparent");
    meta.setAttribute("content", content);
    document.head.append(meta);
  }
}

function startedBeforeSend() {
  const started = initBrowser.mock.calls.at(-1)?.[0] as VigilonBrowserOptions;
  return started.beforeSend as (event: BrowserEvent) => BrowserEvent | null;
}

beforeEach(() => {
  initBrowser.mockClear();
  captureException.mockClear();
  window.history.replaceState(null, "", "/orders/7?tab=items");
});

afterEach(() => setTraceparent(null));

describe("init", () => {
  it("passes the options through untouched without a traceparent meta tag", () => {
    init(options);
    expect(initBrowser).toHaveBeenCalledWith(options);
  });

  it("links events on the server-rendered page to its trace, then runs the app's beforeSend", () => {
    setTraceparent(`00-${TRACE_ID}-00f067aa0ba902b7-01`);
    const beforeSend = vi.fn((e: BrowserEvent) => e);
    init({ ...options, beforeSend });

    const sent = startedBeforeSend()(event(`${window.location.href}#details`));
    expect(sent?.traceId).toBe(TRACE_ID);
    expect(beforeSend).toHaveBeenCalledWith(expect.objectContaining({ traceId: TRACE_ID }));
  });

  it("stops linking once the browser has navigated away from the rendered page", () => {
    setTraceparent(`00-${TRACE_ID}-00f067aa0ba902b7-01`);
    init(options);
    const sent = startedBeforeSend()(event("http://localhost:3000/orders/8"));
    expect(sent?.traceId).toBeNull();
  });

  it("ignores a malformed or all-zero trace ID", () => {
    setTraceparent(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`);
    init(options);
    expect(initBrowser).toHaveBeenCalledWith(options);
  });
});

describe("linkServerTrace", () => {
  it("keeps a trace ID the event already has", () => {
    const url = window.location.href;
    const linked = linkServerTrace(event(url, "a".repeat(32)), { traceId: TRACE_ID, url });
    expect(linked.traceId).toBe("a".repeat(32));
  });
});

describe("useReportError", () => {
  it("reports the error a Next.js error boundary received", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const error = new Error("render failed");
    function ErrorPage() {
      useReportError(error);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<StrictMode><ErrorPage /></StrictMode>));
    expect(captureException).toHaveBeenCalledWith(error, {
      mechanism: "react_error_boundary",
      handled: true,
    });
    act(() => root.unmount());
  });

  it("skips an error from the server, which Next.js redacts and records there", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // What error.tsx receives for a Server Component error in production.
    const error = Object.assign(new Error("An error occurred in the Server Components render."), {
      digest: "3247174154",
    });
    function ErrorPage() {
      useReportError(error);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<ErrorPage />));
    expect(captureException).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
