import { unplugin } from "./plugin";

export type { VigilonPluginOptions } from "./core/build";

/** The Vigilon plugin for Rollup. */
const vigilonRollupPlugin = unplugin.rollup;
export default vigilonRollupPlugin;
export { vigilonRollupPlugin };
