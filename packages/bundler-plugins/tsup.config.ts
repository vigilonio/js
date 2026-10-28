import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts", "src/rollup.ts", "src/webpack.ts", "src/esbuild.ts"],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".cjs" }),
  // tsup's declaration build sets baseUrl, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
  platform: "node",
  target: "node20",
});
