import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserEventEnvelope } from "../../core/envelope";
import {
  captureException,
  close,
  flush,
  init,
  setTag,
  setUser,
  type VigilonBrowserOptions,
} from "../../index";

const options: VigilonBrowserOptions = {
  apiKey: "test-key",
  serviceName: "dashboard",
  environment: "test",
  serviceVersion: "1.2.3",
  endpoint: "https://ingest.example.com/",
};

describe("@vigilon/browser", () => {
  let requests: Array<{ url: string; envelope: BrowserEventEnvelope; keepalive: boolean }>;

  beforeEach(() => {
    requests = [];
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/users/42?token=secret#tab");
    vi.spyOn(window, "fetch").mockImplementation(async (url, init) => {
      requests.push({
        url: String(url),
        envelope: JSON.parse(String(init?.body)),
        keepalive: Boolean(init?.keepalive),
      });
      return new Response(null, { status: 202 });
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await close();
    vi.restoreAllMocks();
  });

  async function sentEvents() {
    await flush();
    return requests.flatMap((request) => request.envelope.events);
  }

  it("is a no-op before init", async () => {
    expect(captureException(new Error("early"))).toBeNull();
    expect(await flush()).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("refuses invalid options without throwing", () => {
    expect(init({ ...options, apiKey: "" })).toBe(false);
    expect(init({ ...options, serviceName: "has spaces" })).toBe(false);
    expect(init({ ...options, environment: "e".repeat(101) })).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("warns once when serviceVersion is missing", () => {
    expect(init({ ...options, serviceVersion: undefined })).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("serviceVersion"));
  });

  it("sends a manual capture with the envelope, page, and session", async () => {
    init(options);
    const eventId = captureException(new TypeError("boom"));
    const [event] = await sentEvents();

    expect(requests[0].url).toBe("https://ingest.example.com/v1/browser/events");
    expect(requests[0].envelope).toMatchObject({
      schema: "vigilon.browser.event@1",
      sdk: { name: "@vigilon/browser" },
      service: { name: "dashboard", environment: "test", version: "1.2.3" },
    });
    expect(event).toMatchObject({
      type: "exception",
      eventId,
      exception: { type: "TypeError", message: "boom", mechanism: "manual", handled: true },
      page: { url: `${window.location.origin}/users/42` },
      user: null,
      traceId: null,
    });
    expect(event.session?.id).toBe(window.sessionStorage.getItem("vigilon.session"));
  });

  it("captures uncaught errors and unhandled rejections", async () => {
    init(options);
    window.dispatchEvent(
      new ErrorEvent("error", { error: new RangeError("uncaught"), message: "uncaught" }),
    );
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = "rejected with a string";
    window.dispatchEvent(rejection);

    const events = await sentEvents();
    expect(events.map((e) => [e.exception.type, e.exception.mechanism, e.exception.handled])).toEqual([
      ["RangeError", "onerror", false],
      ["Error", "unhandledrejection", false],
    ]);
    expect(events[1].exception.message).toBe("rejected with a string");
  });

  it("drops default noise and extension errors", async () => {
    init(options);
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    captureException(new TypeError("Failed to fetch"));
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("from an extension"),
        filename: "chrome-extension://abc/content.js",
      }),
    );
    expect(await sentEvents()).toHaveLength(0);
  });

  it("applies setUser and setTag with the privacy rules", async () => {
    init(options);
    setUser({ id: "user_1" });
    setTag("plan", "pro");
    setTag("auth_token", "secret");
    captureException(new Error("a"));
    setUser({ id: "ada@example.com" });
    captureException(new Error("b"));

    const [first, second] = await sentEvents();
    expect(first.user).toEqual({ id: "user_1" });
    expect(first.tags).toEqual({ plan: "pro" });
    expect(second.user).toBeNull();
  });

  it("reports the debug IDs of the scripts in the stack", async () => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope._vigilonDebugIds = {
      "Error\n    at https://app.example.com/assets/index-3f9c2ab1.js:1:120":
        "c4a1e7d2-5b3f-4e8a-9c6d-1f2e3a4b5c6d",
      "Error\n    at https://app.example.com/assets/unrelated-1a2b3c4d.js:1:120":
        "0b7e9a12-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
    };
    try {
      init(options);
      const error = new TypeError("boom");
      error.stack =
        "TypeError: boom\n    at render (https://app.example.com/assets/index-3f9c2ab1.js:2:4410)";
      captureException(error);
      captureException("no stack");

      const [withStack, withoutStack] = await sentEvents();
      expect(withStack.debugIds).toEqual({
        "https://app.example.com/assets/index-3f9c2ab1.js": "c4a1e7d2-5b3f-4e8a-9c6d-1f2e3a4b5c6d",
      });
      expect(withoutStack.debugIds).toBeUndefined();
    } finally {
      delete scope._vigilonDebugIds;
    }
  });

  it("lets beforeSend edit or drop events, and drops them when it throws", async () => {
    init({
      ...options,
      beforeSend: (event) => {
        if (event.exception.message === "drop") return null;
        if (event.exception.message === "throw") throw new Error("bug");
        return { ...event, exception: { ...event.exception, message: "[redacted]" } };
      },
    });
    captureException(new Error("drop"));
    captureException(new Error("throw"));
    captureException(new Error("secret value"));
    const events = await sentEvents();
    expect(events.map((e) => e.exception.message)).toEqual(["[redacted]"]);
  });

  it("samples with sampleRate", async () => {
    init({ ...options, sampleRate: 0 });
    expect(captureException(new Error("sampled out"))).toBeNull();
    expect(await sentEvents()).toHaveLength(0);
  });

  it("suppresses a repeating error", async () => {
    init(options);
    const error = new Error("loop");
    for (let i = 0; i < 50; i += 1) captureException(error);
    expect(await sentEvents()).toHaveLength(1);
  });

  it("flushes with keepalive when the page is hidden", () => {
    init(options);
    captureException(new Error("before leaving"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    expect(requests).toHaveLength(1);
    expect(requests[0].keepalive).toBe(true);
  });

  it("stops capturing after close", async () => {
    init(options);
    await close();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("after close") }));
    expect(captureException(new Error("after close"))).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
