import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "tanstack-router": "src/tanstack-router.ts",
    "react-router": "src/react-router.ts",
  },
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  // tsup's declaration build sets baseUrl, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
  // Same floor as @vigilon/browser, which this package is used with.
  target: "es2019",
  external: ["react", "@vigilon/browser"],
  // Every entry runs in the browser only. ErrorBoundary is a class component,
  // so frameworks that render on the server by default (the Next.js App
  // Router) must treat these modules as client code.
  banner: { js: '"use client";' },
});
