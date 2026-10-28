import { runInNewContext } from "node:vm";
import { eachMapping, TraceMap, type EachMapping } from "@jridgewell/trace-mapping";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { registrationSnippet } from "../debug-id";
import { injectDebugId } from "../inject";

const SOURCE = `export function formatPrice(price) {
  if (price === undefined) {
    throw new TypeError("price-missing");
  }
  return "$" + price.toFixed(2);
}
export const total = (items) => items.reduce((sum, item) => sum + item.price, 0);
`;

function compile(minify: boolean, banner = "") {
  const { code, map } = transformSync(SOURCE, {
    format: "cjs",
    minify,
    sourcemap: "external",
    sourcefile: "src/lib.js",
    banner,
  });
  return { code, map };
}

function mappings(code: string, map: string) {
  const found: Array<Omit<EachMapping, "generatedLine" | "generatedColumn"> & { text: string }> = [];
  const lines = code.split("\n");
  eachMapping(new TraceMap(map), (mapping) => {
    const { generatedLine, generatedColumn, ...original } = mapping;
    found.push({ ...original, text: lines[generatedLine - 1].slice(generatedColumn, generatedColumn + 12) });
  });
  return found;
}

/** Every mapping still points at the same generated text after injection. */
function expectMappingsPreserved(before: { code: string; map: string }, after: { code: string; map: string }) {
  const original = mappings(before.code, before.map);
  expect(original.length).toBeGreaterThan(5);
  expect(mappings(after.code, after.map)).toEqual(original);
}

describe("injectDebugId", () => {
  it.each([
    ["unminified", compile(false)],
    ["minified", compile(true)],
    ["a hashbang", compile(false, "#!/usr/bin/env node")],
    ["a directive on its own line", compile(false, '"use strict";')],
    ["a directive mid-line in minified code", compile(true, '/*! license */"use strict";')],
  ])("registers, comments, and keeps the map exact for %s", (_label, chunk) => {
    const injected = injectDebugId(chunk.code, chunk.map);

    expect(injected.reused).toBe(false);
    expect(injected.code).toContain(registrationSnippet(injected.debugId));
    expect(injected.code.trimEnd().endsWith(`//# debugId=${injected.debugId}`)).toBe(true);
    expect(JSON.parse(injected.map).debugId).toBe(injected.debugId);
    expectMappingsPreserved(chunk, injected);
  });

  it("keeps a hashbang and a directive ahead of the registration", () => {
    const withHashbang = injectDebugId(compile(false, "#!/usr/bin/env node").code, compile(false).map);
    expect(withHashbang.code.startsWith("#!/usr/bin/env node\n;!function")).toBe(true);

    const { code, map } = compile(true, '"use strict";');
    expect(injectDebugId(code, map).code.startsWith('"use strict";\n;!function')).toBe(true);
  });

  it("puts the comment before a sourceMappingURL comment", () => {
    const chunk = compile(false);
    const code = `${chunk.code}//# sourceMappingURL=lib.js.map\n`;
    const injected = injectDebugId(code, chunk.map);
    expect(injected.code.endsWith(`//# debugId=${injected.debugId}\n//# sourceMappingURL=lib.js.map\n`)).toBe(
      true,
    );
    expectMappingsPreserved({ code, map: chunk.map }, injected);
  });

  it("is idempotent", () => {
    const chunk = compile(true);
    const once = injectDebugId(chunk.code, chunk.map);
    const twice = injectDebugId(once.code, once.map);
    expect(twice).toEqual({ ...once, reused: true });
  });

  it("reuses Sentry's ID without a second registration", () => {
    const id = "c4a1e7d2-5b3f-4e8a-9c6d-1f2e3a4b5c6d";
    const sentry = `!function(){try{var e=globalThis;var n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="${id}",e._sentryDebugIdIdentifier="sentry-dbid-${id}")}catch(e){}}();`;
    const chunk = compile(true, sentry);
    const injected = injectDebugId(chunk.code, chunk.map);

    expect(injected).toMatchObject({ debugId: id, reused: true });
    expect(injected.code).not.toContain("_vigilonDebugIds");
    expect(injected.code.match(/\/\/# debugId=/g)).toHaveLength(1);
    expect(JSON.parse(injected.map).debugId).toBe(id);
    expectMappingsPreserved(chunk, injected);
  });

  it("registers an ID the bundler stamped without a runtime registration", () => {
    const id = "0b7e9a12-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
    const chunk = compile(false);
    const code = `${chunk.code}//# debugId=${id}\n`;
    const map = JSON.stringify({ ...JSON.parse(chunk.map), debugId: id });
    const injected = injectDebugId(code, map);

    expect(injected).toMatchObject({ debugId: id, reused: true });
    expect(injected.code).toContain(registrationSnippet(id));
    expect(injected.code.match(/\/\/# debugId=/g)).toHaveLength(1);
  });

  it("drops debug_id so the map carries one ID", () => {
    const chunk = compile(false);
    const id = "0b7e9a12-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
    const injected = injectDebugId(chunk.code, JSON.stringify({ ...JSON.parse(chunk.map), debug_id: id }));
    expect(JSON.parse(injected.map)).toMatchObject({ debugId: id });
    expect(JSON.parse(injected.map)).not.toHaveProperty("debug_id");
  });

  it("refuses indexed maps", () => {
    expect(() => injectDebugId("a();", JSON.stringify({ version: 3, sections: [] }))).toThrow(/indexed/);
  });

  it("registers the ID under a stack whose top frame is the script", () => {
    const { code, map } = compile(true);
    const injected = injectDebugId(code, map);
    const scope: Record<string, unknown> = { module: { exports: {} } };
    scope.globalThis = scope;
    runInNewContext(injected.code, scope, { filename: "https://app.example.com/assets/lib-3f9c2ab1.js" });

    const registry = scope._vigilonDebugIds as Record<string, string>;
    const [[stack, id]] = Object.entries(registry);
    expect(id).toBe(injected.debugId);
    expect(stack.split("\n")[1]).toContain("https://app.example.com/assets/lib-3f9c2ab1.js:");
  });
});
