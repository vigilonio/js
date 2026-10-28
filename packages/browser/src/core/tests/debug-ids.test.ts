import { describe, expect, it } from "vitest";
import { DebugIdIndex } from "../debug-ids";

const APP_ID = "c4a1e7d2-5b3f-4e8a-9c6d-1f2e3a4b5c6d";
const VENDOR_ID = "0b7e9a12-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const OTHER_ID = "5d2c8b1a-9e7f-4c3d-a2b1-0f9e8d7c6b5a";

// What a registration snippet's `new Error().stack` looks like in each engine.
const V8_KEY = "Error\n    at https://app.example.com/assets/index-3f9c2ab1.js:1:120";
const FIREFOX_KEY = "@https://app.example.com/assets/vendor-8e1d4c07.js:1:98\n";
const WEBKIT_KEY = "global code@https://app.example.com/assets/lazy-77aa01bc.js:1:64";

const V8_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at renderInvoice (https://app.example.com/assets/index-3f9c2ab1.js:2:4410)",
  "    at https://app.example.com/assets/vendor-8e1d4c07.js:9:120",
].join("\n");

describe("DebugIdIndex", () => {
  it("reports the debug IDs of the scripts in the stack", () => {
    const index = new DebugIdIndex({
      _vigilonDebugIds: { [V8_KEY]: APP_ID, [FIREFOX_KEY]: VENDOR_ID, [WEBKIT_KEY]: OTHER_ID },
    });
    expect(index.forStacks([V8_STACK])).toEqual({
      "https://app.example.com/assets/index-3f9c2ab1.js": APP_ID,
      "https://app.example.com/assets/vendor-8e1d4c07.js": VENDOR_ID,
    });
  });

  it("reads Sentry's and the bundler-neutral registries too", () => {
    const index = new DebugIdIndex({
      _sentryDebugIds: { [V8_KEY]: APP_ID },
      _debugIds: { [FIREFOX_KEY]: VENDOR_ID },
    });
    expect(index.forStacks([V8_STACK])).toEqual({
      "https://app.example.com/assets/index-3f9c2ab1.js": APP_ID,
      "https://app.example.com/assets/vendor-8e1d4c07.js": VENDOR_ID,
    });
  });

  it("prefers Vigilon's registry, then Sentry's, then the bundler-neutral one", () => {
    const index = new DebugIdIndex({
      _debugIds: { [V8_KEY]: OTHER_ID },
      _sentryDebugIds: { [V8_KEY]: VENDOR_ID },
      _vigilonDebugIds: { [V8_KEY]: APP_ID },
    });
    expect(index.forStacks([V8_STACK])).toEqual({
      "https://app.example.com/assets/index-3f9c2ab1.js": APP_ID,
    });
  });

  it("sees scripts registered after the first lookup", () => {
    const registry: Record<string, string> = { [V8_KEY]: APP_ID };
    const index = new DebugIdIndex({ _vigilonDebugIds: registry });
    expect(Object.keys(index.forStacks([V8_STACK]) ?? {})).toHaveLength(1);

    registry[FIREFOX_KEY] = VENDOR_ID;
    expect(Object.keys(index.forStacks([V8_STACK]) ?? {})).toHaveLength(2);
  });

  it("matches cause stacks and keys whose URL carried a query string", () => {
    const index = new DebugIdIndex({
      _vigilonDebugIds: {
        "Error\n    at https://app.example.com/assets/lazy-77aa01bc.js?v=2&token=secret:1:64": OTHER_ID,
      },
    });
    const causeStack = "loadInvoices@https://app.example.com/assets/lazy-77aa01bc.js?v=2:4:18";
    expect(index.forStacks([null, causeStack])).toEqual({
      "https://app.example.com/assets/lazy-77aa01bc.js": OTHER_ID,
    });
  });

  it("does not match a script whose URL is a prefix of another's", () => {
    const index = new DebugIdIndex({
      _vigilonDebugIds: { "Error\n    at https://app.example.com/a.js:1:1": APP_ID },
    });
    expect(index.forStacks(["Error\n    at https://app.example.com/a.jsx:3:9"])).toBeUndefined();
  });

  it("ignores missing registries, malformed entries, and absent stacks", () => {
    const index = new DebugIdIndex({
      _vigilonDebugIds: { "no frame here": APP_ID, [V8_KEY]: 42 },
      _sentryDebugIds: "not a registry",
    });
    expect(index.forStacks([V8_STACK])).toBeUndefined();
    expect(new DebugIdIndex({}).forStacks([null, undefined])).toBeUndefined();
  });

  it.each([
    [
      "V8",
      "Error\n    at https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js:1:120",
      "TypeError: boom\n    at Page (https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js:2:4410)",
    ],
    [
      "SpiderMonkey",
      "@https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js:1:98\n",
      "Page@https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js:2:4410\n",
    ],
    [
      "JavaScriptCore",
      "global code@https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js:1:64",
      "Page@https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js:2:4410",
    ],
  ])("matches a script URL with parentheses in %s stacks", (_engine, key, stack) => {
    const index = new DebugIdIndex({ _vigilonDebugIds: { [key]: APP_ID } });
    expect(index.forStacks([stack])).toEqual({
      "https://app.example.com/_next/static/chunks/app/(dashboard)/page-1a2b3c4d.js": APP_ID,
    });
  });
});
