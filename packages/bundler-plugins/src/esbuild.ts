import { unplugin } from "./plugin";

export type { VigilonPluginOptions } from "./core/build";

/** The Vigilon plugin for Esbuild. */
const vigilonEsbuildPlugin = unplugin.esbuild;
export default vigilonEsbuildPlugin;
export { vigilonEsbuildPlugin };
