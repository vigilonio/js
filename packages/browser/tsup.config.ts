import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};
const define = { __VIGILON_SDK_VERSION__: JSON.stringify(version) };
// ES2019 keeps optional chaining and nullish coalescing transpiled, so the
// package runs in every browser that has fetch with keepalive.
const target = "es2019";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
    // tsup's declaration build sets baseUrl, which TypeScript 6 deprecates.
    dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
    sourcemap: true,
    clean: true,
    target,
    define,
  },
  {
    // The script-tag build for unpkg and jsDelivr: exposes window.Vigilon.
    entry: { "vigilon.min": "src/index.ts" },
    format: ["iife"],
    globalName: "Vigilon",
    outExtension: () => ({ js: ".js" }),
    minify: true,
    sourcemap: true,
    target,
    define,
  },
]);
