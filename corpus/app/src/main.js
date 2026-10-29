// Runs one corpus case per page load, named by ?case=, and reports it with
// @vigilon/browser to the page's own origin, where the generator listens.
import { captureException, flush, init } from "@vigilon/browser";
import { cases } from "./cases.js";

init({
  apiKey: "corpus",
  serviceName: "corpus",
  environment: "corpus",
  serviceVersion: __CORPUS_RELEASE__,
  endpoint: location.origin,
});

globalThis.__corpus = { flush, captureException };

const [run, ...args] = cases[new URLSearchParams(location.search).get("case")];
// From a timer, so a thrown error is uncaught and reaches window.onerror, and
// through this one named function for every case.
setTimeout(function runCase() {
  return run(...args);
}, 0);
