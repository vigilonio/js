import { unplugin } from "./plugin";

export type { VigilonPluginOptions } from "./core/build";

/** The Vigilon plugin for Webpack. */
const vigilonWebpackPlugin = unplugin.webpack;
export default vigilonWebpackPlugin;
export { vigilonWebpackPlugin };
