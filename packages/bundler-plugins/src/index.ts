/**
 * @vigilon/bundler-plugins: gives every emitted script a debug ID and uploads
 * its source map to Vigilon, so browser errors show original source.
 *
 * Import the plugin for your bundler from its subpath, for example
 * `@vigilon/bundler-plugins/vite`, or by name from here.
 */
import { unplugin } from "./plugin";

export type { VigilonPluginOptions } from "./core/build";

export const vigilonVitePlugin = unplugin.vite;
export const vigilonRollupPlugin = unplugin.rollup;
export const vigilonWebpackPlugin = unplugin.webpack;
export const vigilonEsbuildPlugin = unplugin.esbuild;
