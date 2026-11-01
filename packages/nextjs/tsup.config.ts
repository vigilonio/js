import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as ("esm" | "cjs")[],
  outExtension: ({ format }: { format: string }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  // tsup's declaration build sets baseUrl, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
};

export default defineConfig([
  {
    ...shared,
    // The browser entry, for instrumentation-client.ts and client components.
    entry: { index: "src/client/index.ts" },
    target: "es2019",
    external: ["react", "next", "@vigilon/react"],
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    // instrumentation.ts (Node.js runtime) and next.config.
    entry: { server: "src/server/index.ts", config: "src/config/index.ts" },
    platform: "node",
    target: "node22",
    // config uses import.meta.url, which the CommonJS build needs shimmed:
    // next.config.js loads it with require().
    shims: true,
  },
]);
