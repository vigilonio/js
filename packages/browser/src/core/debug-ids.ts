import { scrubUrl, scrubUrlsInText } from "./text";

/*
 * Debug IDs link a script to the source map uploaded for it. A build plugin
 * registers each script's ID at runtime in a global registry keyed by the
 * stack of an Error created inside that script, so the key's top frame names
 * the script's URL. Registries are read in order of precedence: Vigilon's
 * own, then Sentry's and the bundler-neutral one, so a build that already
 * registers IDs for another tool needs no second pass.
 */
const REGISTRIES = ["_vigilonDebugIds", "_sentryDebugIds", "_debugIds"] as const;

// A frame's script URL: V8's `at url:1:2` and `at fn (url:1:2)`, and
// SpiderMonkey's and JavaScriptCore's `fn@url:1:2`. The URL may contain
// parentheses (Next.js route groups), so its end is the `:line:column`.
const FRAME_URL = /([a-z][a-z0-9+.-]*:\/\/\S+?):\d+:\d+/i;

type Registry = Record<string, unknown>;

export class DebugIdIndex {
  private indexedEntries = -1;
  private byUrl: Record<string, string> = {};

  constructor(private readonly scope: Record<string, unknown>) {}

  /**
   * The debug IDs of the registered scripts that appear in these stacks,
   * keyed by scrubbed script URL, or undefined when none do.
   */
  forStacks(stacks: Array<string | null | undefined>): Record<string, string> | undefined {
    const text = scrubUrlsInText(stacks.filter(Boolean).join("\n"));
    if (text.length === 0) {
      return undefined;
    }
    let found: Record<string, string> | undefined;
    for (const [url, id] of Object.entries(this.registered())) {
      // The `:` of the frame's line number keeps `a.js` from matching `a.jsx`.
      if (text.includes(`${url}:`)) {
        found ??= {};
        found[url] = id;
      }
    }
    return found;
  }

  /** Script URL to debug ID, rebuilt only when a registry has grown. */
  private registered(): Record<string, string> {
    const registries = REGISTRIES.map((name) => this.scope[name]).filter(isRegistry);
    const entries = registries.reduce((total, registry) => total + Object.keys(registry).length, 0);
    if (entries === this.indexedEntries) {
      return this.byUrl;
    }
    const byUrl: Record<string, string> = {};
    for (const registry of registries) {
      for (const [stack, id] of Object.entries(registry)) {
        const url = scriptUrl(stack);
        if (url !== null && typeof id === "string" && !(url in byUrl)) {
          byUrl[url] = id;
        }
      }
    }
    this.indexedEntries = entries;
    this.byUrl = byUrl;
    return byUrl;
  }
}

function scriptUrl(stack: string): string | null {
  for (const line of stack.split("\n")) {
    const match = FRAME_URL.exec(line);
    if (match) {
      return scrubUrl(match[1]);
    }
  }
  return null;
}

function isRegistry(value: unknown): value is Registry {
  return typeof value === "object" && value !== null;
}
