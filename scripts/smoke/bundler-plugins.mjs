// Loads the packed @vigilon/bundler-plugins the way build configs do: each
// bundler's subpath as ESM (Vite, Rollup, esbuild configs) and as CommonJS
// (webpack configs), and checks that each returns a plugin for its bundler.
import { createRequire } from "node:module";
import * as root from "@vigilon/bundler-plugins";
import esbuild from "@vigilon/bundler-plugins/esbuild";
import rollup from "@vigilon/bundler-plugins/rollup";
import vite from "@vigilon/bundler-plugins/vite";
import webpack from "@vigilon/bundler-plugins/webpack";

const require = createRequire(import.meta.url);
const failures = [];
const check = (ok, message) => ok || failures.push(message);

check(vite().name === "vigilon", "the Vite plugin must load from its subpath");
check(rollup().name === "vigilon", "the Rollup plugin must load from its subpath");
check(typeof esbuild().setup === "function", "the esbuild plugin must have a setup function");
check(typeof webpack().apply === "function", "the webpack plugin must have an apply function");
check(root.vigilonVitePlugin().name === "vigilon", "the root entry must export every plugin");

const cjs = require("@vigilon/bundler-plugins/webpack");
check(typeof cjs.default().apply === "function", "the CommonJS webpack entry must load");
check(typeof require("@vigilon/bundler-plugins").vigilonEsbuildPlugin === "function", "the CommonJS root entry must load");

if (failures.length > 0) {
  console.error(`smoke [bundler-plugins]: FAILED\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log("smoke [bundler-plugins]: OK — every bundler's plugin loads from the packed tarball (ESM and CJS)");
