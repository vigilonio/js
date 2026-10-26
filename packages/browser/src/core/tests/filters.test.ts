import { describe, expect, it } from "vitest";
import type { BrowserEvent } from "../envelope";
import { DEFAULT_DENY_URLS, DEFAULT_IGNORE_ERRORS, isDeniedUrl, isIgnoredError } from "../filters";

function event(type: string, message: string, stack: string | null = null): BrowserEvent {
  return {
    type: "exception",
    eventId: "00000000-0000-4000-8000-000000000000",
    timestamp: "2026-10-26T00:00:00.000Z",
    exception: { type, message, stack, mechanism: "onerror", handled: false },
    page: { url: "https://app.example.com/" },
  };
}

describe("default ignoreErrors", () => {
  it.each([
    ["Error", "Script error."],
    ["TypeError", "Failed to fetch"],
    ["TypeError", "NetworkError when attempting to fetch resource."],
    ["TypeError", "Load failed"],
    ["AbortError", "The user aborted a request."],
    ["Error", "ResizeObserver loop completed with undelivered notifications."],
  ])("drops %s: %s", (type, message) => {
    expect(isIgnoredError(event(type, message), DEFAULT_IGNORE_ERRORS)).toBe(true);
  });

  it("keeps ordinary application errors", () => {
    expect(isIgnoredError(event("TypeError", "x is undefined"), DEFAULT_IGNORE_ERRORS)).toBe(false);
  });

  it("matches application patterns as substrings or regular expressions", () => {
    expect(isIgnoredError(event("Error", "quota exceeded"), ["quota"])).toBe(true);
    expect(isIgnoredError(event("ChunkLoadError", "x"), [/^ChunkLoadError:/])).toBe(true);
  });
});

describe("default denyUrls", () => {
  it("drops errors thrown from browser extensions", () => {
    const stack = "TypeError: x\n    at f (chrome-extension://abc/content.js:1:2)";
    expect(isDeniedUrl(event("TypeError", "x", stack), undefined, DEFAULT_DENY_URLS)).toBe(true);
    expect(
      isDeniedUrl(event("Error", "x"), "moz-extension://abc/script.js", DEFAULT_DENY_URLS),
    ).toBe(true);
  });

  it("keeps errors from the application's own scripts", () => {
    const stack = "TypeError: x\n    at f (https://app.example.com/a.js:1:2)";
    expect(isDeniedUrl(event("TypeError", "x", stack), undefined, DEFAULT_DENY_URLS)).toBe(false);
  });
});
