// CommonJS preload entrypoint: `node --require @vigilon/node/register app.js`.
// register() is idempotent (guards on Symbol.for("vigilon.register.started")),
// so a preload plus an in-process register() call cannot start two SDKs.
require("./dist/cjs/index.js").registerFromEnv();
