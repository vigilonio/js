import { describe, expect, it } from "vitest";
import { debugIdFor, existingDebugId, registrationSnippet } from "../debug-id";

const ID = "c4a1e7d2-5b3f-4e8a-9c6d-1f2e3a4b5c6d";
const OTHER = "0b7e9a12-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const SENTRY_SNIPPET = `!function(){try{var e=globalThis;var n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="${ID}",e._sentryDebugIdIdentifier="sentry-dbid-${ID}")}catch(e){}}();`;

describe("debugIdFor", () => {
  it("is a version 4 UUID that depends on both the code and the map", () => {
    const id = debugIdFor("console.log(1)", '{"mappings":"AAAA"}');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(debugIdFor("console.log(1)", '{"mappings":"AAAA"}')).toBe(id);
    expect(debugIdFor("console.log(1)", '{"mappings":"AACA"}')).not.toBe(id);
    expect(debugIdFor("console.log(2)", '{"mappings":"AAAA"}')).not.toBe(id);
  });
});

describe("existingDebugId", () => {
  it("finds nothing in a plain chunk", () => {
    expect(existingDebugId("console.log(1);\n", {})).toBeNull();
  });

  it("reads a trailing comment, before a sourceMappingURL comment too", () => {
    expect(
      existingDebugId(`a();\n//# debugId=${ID.toUpperCase()}\n//# sourceMappingURL=a.js.map\n`, {}),
    ).toEqual({ debugId: ID, registered: false, commented: true });
  });

  it("reads Sentry's registration at the head of the chunk", () => {
    expect(existingDebugId(`${SENTRY_SNIPPET}a();`, {})).toEqual({
      debugId: ID,
      registered: true,
      commented: false,
    });
  });

  it("reads Sentry's registration after a minifier renamed and requoted it", () => {
    const minified = `(function(){try{var e=globalThis,t=new e.Error().stack;t&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[t]=\`${ID}\`,e._sentryDebugIdIdentifier=\`sentry-dbid-${ID}\`)}catch{}})();a();`;
    expect(existingDebugId(minified, {})).toEqual({ debugId: ID, registered: true, commented: false });
  });

  it("reads its own registration", () => {
    expect(existingDebugId(`${registrationSnippet(ID)}\na();\n//# debugId=${ID}\n`, {})).toEqual({
      debugId: ID,
      registered: true,
      commented: true,
    });
  });

  it("falls back to the map's debugId or debug_id", () => {
    expect(existingDebugId("a();", { debugId: ID })).toEqual({
      debugId: ID,
      registered: false,
      commented: false,
    });
    expect(existingDebugId("a();", { debug_id: ID })?.debugId).toBe(ID);
    expect(existingDebugId("a();", { debugId: "not-a-uuid" })).toBeNull();
  });

  it("prefers the comment, and does not call a different registration its own", () => {
    expect(existingDebugId(`${SENTRY_SNIPPET}a();\n//# debugId=${OTHER}\n`, { debugId: ID })).toEqual({
      debugId: OTHER,
      registered: false,
      commented: true,
    });
  });

  it("ignores a debug ID carried by a library bundled into the middle of the chunk", () => {
    const filler = "x();\n".repeat(2000);
    const vendored = `${filler}${SENTRY_SNIPPET}\n//# debugId=${ID}\n${filler}`;
    expect(existingDebugId(vendored, {})).toBeNull();
  });
});
