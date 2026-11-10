import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Breadcrumb, BrowserEventEnvelope } from "../../core/envelope";
import {
  addBreadcrumb,
  captureException,
  close,
  flush,
  init,
  type VigilonBrowserOptions,
} from "../../index";
import { instrumentXhr, selectorOf } from "../breadcrumbs";

const options: VigilonBrowserOptions = {
  apiKey: "test-key",
  appName: "dashboard",
  environment: "test",
  appVersion: "1.2.3",
  endpoint: "https://ingest.example.com",
};

describe("breadcrumbs", () => {
  let envelopes: BrowserEventEnvelope[];
  let appRequests: string[];

  beforeEach(() => {
    envelopes = [];
    appRequests = [];
    window.history.replaceState(null, "", "/start");
    vi.spyOn(window, "fetch").mockImplementation(async (input, request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://ingest.example.com/")) {
        envelopes.push(JSON.parse(String(request?.body)));
        return new Response(null, { status: 202 });
      }
      appRequests.push(url);
      if (url.includes("/offline")) {
        throw new TypeError("Failed to fetch");
      }
      return new Response(null, { status: url.includes("/missing") ? 404 : 200 });
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await close();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  async function sentBreadcrumbs(): Promise<Breadcrumb[][]> {
    await flush();
    return envelopes.flatMap((envelope) => envelope.events.map((event) => event.breadcrumbs ?? []));
  }

  async function capturedBreadcrumbs(): Promise<Breadcrumb[]> {
    captureException(new Error("boom"));
    const sent = await sentBreadcrumbs();
    return sent[sent.length - 1] ?? [];
  }

  it("records navigations as paths, without query or fragment", async () => {
    init(options);
    window.history.pushState(null, "", "/users/42?token=t#tab");
    window.history.replaceState(null, "", "/users/42/edit");
    window.history.pushState(null, "", "/users/42/edit?again=1");

    expect((await capturedBreadcrumbs()).map((entry) => entry.data)).toEqual([
      { from: "/start", to: "/users/42" },
      { from: "/users/42", to: "/users/42/edit" },
    ]);
  });

  it("records a click as a selector, never the element's text", async () => {
    init(options);
    const button = document.createElement("button");
    button.id = "save";
    button.className = "btn primary third";
    button.textContent = "Pay jane@example.com";
    document.body.append(button);
    button.click();

    const [click] = await capturedBreadcrumbs();
    expect(click).toMatchObject({ category: "click", message: "button#save.btn.primary" });
    expect(JSON.stringify(click)).not.toContain("jane");
    expect(selectorOf(document)).toBeNull();
  });

  it("records console warnings and errors by default, never the SDK's own diagnostics", async () => {
    init(options);
    console.log("chatter");
    console.warn("login failed for", { password: "hunter2" });
    console.error(new TypeError("render failed"));
    console.error({ user: "u1", password: "p", nested: { token: "t", ok: 1 } });
    console.warn("[Vigilon] a diagnostic");

    const breadcrumbs = await capturedBreadcrumbs();
    // The first argument only; an object loses its credential-named keys.
    expect(breadcrumbs).toEqual([
      expect.objectContaining({ category: "console", level: "warning", message: "login failed for" }),
      expect.objectContaining({ category: "console", level: "error", message: "TypeError: render failed" }),
      expect.objectContaining({ category: "console", level: "error", message: '{"user":"u1","nested":{"ok":1}}' }),
    ]);
    expect(JSON.stringify(breadcrumbs)).not.toMatch(/hunter2|"p"|"t"/);
  });

  it("records the console levels it is given, or none", async () => {
    init({ ...options, breadcrumbs: { console: true } });
    console.log("now included");
    expect((await capturedBreadcrumbs()).map((entry) => entry.message)).toEqual(["now included"]);
    await close();

    envelopes = [];
    init({ ...options, breadcrumbs: { console: false } });
    console.error("not recorded");
    expect(await capturedBreadcrumbs()).toEqual([]);
  });

  it("records fetch requests with a scrubbed URL, status, and duration", async () => {
    init(options);
    await window.fetch("https://api.example.com/v1/users?token=t", { method: "post" });
    await window.fetch(new Request("https://api.example.com/missing"));
    await window.fetch("/offline").catch(() => undefined);

    const requests = (await capturedBreadcrumbs()).filter((entry) => entry.category === "fetch");
    expect(requests).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ method: "POST", url: "https://api.example.com/v1/users", status_code: 200 }),
      }),
      expect.objectContaining({
        level: "warning",
        data: expect.objectContaining({ method: "GET", url: "https://api.example.com/missing", status_code: 404 }),
      }),
      expect.objectContaining({
        level: "error",
        data: expect.objectContaining({ url: "/offline", status_code: 0 }),
      }),
    ]);
    expect(requests.every((entry) => typeof entry.data?.duration_ms === "number")).toBe(true);
    expect(requests[0]).not.toHaveProperty("level");
  });

  it("never records the SDK's own requests", async () => {
    init(options);
    captureException(new Error("first"));
    await flush();
    captureException(new Error("second"));
    const [, second] = await sentBreadcrumbs();

    expect(envelopes).toHaveLength(2);
    expect(second.filter((entry) => entry.category === "fetch")).toEqual([]);
  });

  // Dispatches readystatechange in registration order, with the
  // onreadystatechange handler holding the place where it was first assigned.
  class FakeXhr {
    status = 0;
    readyState = 0;
    private readonly listeners: Array<(event: Event) => void> = [];
    private handler: ((event: Event) => void) | null = null;
    private handlerSlot = false;
    get onreadystatechange() {
      return this.handler;
    }
    set onreadystatechange(handler: ((event: Event) => void) | null) {
      this.handler = handler;
      if (!this.handlerSlot) {
        this.handlerSlot = true;
        this.listeners.push((event) => this.handler?.call(this, event));
      }
    }
    open(_method: string, _url: string) {
      this.readyState = 1;
    }
    send() {
      this.readyState = 4;
      this.status = 503;
      // DONE is announced twice here; a request is recorded once.
      for (let i = 0; i < 2; i += 1) {
        for (const listener of [...this.listeners]) listener(new Event("readystatechange"));
      }
    }
    addEventListener(type: string, listener: (event: Event) => void) {
      if (type === "readystatechange") this.listeners.push(listener);
    }
  }

  function xhrBreadcrumbs(breadcrumbs: Breadcrumb[]) {
    return breadcrumbs.filter((entry) => entry.category === "xhr");
  }

  it("records XMLHttpRequest requests once, scrubbed, skipping the SDK's own", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    init(options);
    const request = new XMLHttpRequest();
    request.open("get", "//bob:pw@api.example.com/v1/report?sig=s");
    request.send();
    const own = new XMLHttpRequest();
    own.open("POST", "https://ingest.example.com/v1/browser/events");
    own.send();
    const breadcrumbs = await capturedBreadcrumbs();
    await close();
    vi.unstubAllGlobals();

    expect(xhrBreadcrumbs(breadcrumbs)).toEqual([
      expect.objectContaining({
        level: "error",
        data: expect.objectContaining({ method: "GET", url: "//api.example.com/v1/report", status_code: 503 }),
      }),
    ]);
  });

  it("records an XMLHttpRequest before the application's own DONE handlers run", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const seen: number[] = [];
    // beforeSend sees the breadcrumbs an error captured at that moment carries.
    init({
      ...options,
      beforeSend: (event) => {
        seen.push(xhrBreadcrumbs(event.breadcrumbs ?? []).length);
        return null;
      },
    });
    // A handler assigned before open() and a listener added after it.
    const early = new XMLHttpRequest();
    early.onreadystatechange = () => {
      if (early.readyState === 4) captureException(new Error("early done"));
    };
    early.open("GET", "/api/early");
    const late = new XMLHttpRequest();
    late.open("GET", "/api/late");
    late.addEventListener("readystatechange", () => {
      if (late.readyState === 4) captureException(new Error("late done"));
    });
    early.send();
    late.send();
    await close();
    vi.unstubAllGlobals();

    // Each handler already sees its own request: one, then both.
    expect(seen).toEqual([1, 1, 2, 2]);
  });

  it("adds custom breadcrumbs, also with automatic ones turned off", async () => {
    init({ ...options, breadcrumbs: false });
    window.history.pushState(null, "", "/elsewhere");
    console.error("not recorded");
    addBreadcrumb({ message: "checkout started", data: { step: 1, express: true } });
    addBreadcrumb({ category: "navigation", message: "opened the cart drawer" });

    expect(await capturedBreadcrumbs()).toEqual([
      expect.objectContaining({ category: "custom", message: "checkout started", data: { step: 1, express: true } }),
      expect.objectContaining({ category: "navigation", message: "opened the cart drawer" }),
    ]);
  });

  it("does not record what beforeBreadcrumb itself logs, so a logging hook cannot recurse", async () => {
    let calls = 0;
    init({
      ...options,
      beforeBreadcrumb: (breadcrumb) => {
        calls += 1;
        console.warn("hook saw", breadcrumb.category);
        console.error("and again");
        return breadcrumb;
      },
    });
    addBreadcrumb({ message: "one" });
    console.warn("two");

    expect((await capturedBreadcrumbs()).map((entry) => entry.message)).toEqual(["one", "two"]);
    expect(calls).toBe(2);
  });

  it("removes userinfo from protocol-relative request URLs", async () => {
    init(options);
    await window.fetch("//alice:secret@api.example.com/path?token=x");

    const [request] = (await capturedBreadcrumbs()).filter((entry) => entry.category === "fetch");
    expect(request.data?.url).toBe("//api.example.com/path");
    expect(JSON.stringify(envelopes)).not.toMatch(/alice|secret|token/);
  });

  it("lets beforeBreadcrumb edit or drop a breadcrumb, and drops one when it throws", async () => {
    init({
      ...options,
      beforeBreadcrumb: (breadcrumb) => {
        if (breadcrumb.message === "drop me") return null;
        if (breadcrumb.message === "throw") throw new Error("bad hook");
        return { ...breadcrumb, message: breadcrumb.message?.toUpperCase() };
      },
    });
    addBreadcrumb({ message: "keep me" });
    addBreadcrumb({ message: "drop me" });
    addBreadcrumb({ message: "throw" });

    expect((await capturedBreadcrumbs()).map((entry) => entry.message)).toEqual(["KEEP ME"]);
  });

  it("sends the 50 most recent breadcrumbs", async () => {
    init(options);
    for (let i = 0; i < 60; i += 1) addBreadcrumb({ message: `step ${i}` });

    const breadcrumbs = await capturedBreadcrumbs();
    expect(breadcrumbs).toHaveLength(50);
    expect(breadcrumbs[0].message).toBe("step 10");
  });

  it("sends no breadcrumbs field when there are none", async () => {
    init(options);
    captureException(new Error("boom"));
    await flush();
    expect(envelopes[0].events[0]).not.toHaveProperty("breadcrumbs");
  });

  it("puts history, console, and fetch back on close", async () => {
    const pushState = window.history.pushState;
    const warn = console.warn;
    const fetch = window.fetch;
    init(options);
    expect(window.history.pushState).not.toBe(pushState);
    expect(console.warn).not.toBe(warn);
    expect(window.fetch).not.toBe(fetch);
    await close();
    expect(window.history.pushState).toBe(pushState);
    expect(console.warn).toBe(warn);
    expect(window.fetch).toBe(fetch);
  });
});
