import { unplugin } from "./plugin";

export type { VigilonPluginOptions } from "./core/build";

/** The Vigilon plugin for Vite. */
const vigilonVitePlugin = unplugin.vite;
export default vigilonVitePlugin;
export { vigilonVitePlugin };
