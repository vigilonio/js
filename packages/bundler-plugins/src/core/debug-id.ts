import { createHash } from "node:crypto";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// A bundled library can carry its own debug ID snippet or comment, so only a
// chunk's own head and tail are searched, the same windows other tools use.
const HEAD_LENGTH = 6000;
const TAIL_LENGTH = 500;

const COMMENT = new RegExp(`//# debugId=(${UUID})\\s*(?://#[^\\n]*\\s*)*$`);
// A registration as written, or after a minifier has renamed its variables
// and requoted its strings (Vite minifies after other plugins inject).
const registration = (registry: string) =>
  new RegExp(`\\b${registry}\\[[^\\]]*\\]\\s*=\\s*["'\`](${UUID})["'\`]`);
const REGISTRATIONS = [
  registration("_vigilonDebugIds"),
  registration("_sentryDebugIds"),
  new RegExp(`sentry-dbid-(${UUID})`),
  registration("_debugIds"),
];

export interface ExistingDebugId {
  debugId: string;
  /** The chunk already registers this ID at runtime in a registry the SDK reads. */
  registered: boolean;
  /** The chunk already ends with a `//# debugId=` comment. */
  commented: boolean;
}

/**
 * A UUID derived from the chunk and its map, so the same build output always
 * gets the same ID and a changed map never reuses an ID already uploaded.
 */
export function debugIdFor(code: string, map: string): string {
  const hex = createHash("sha256").update(code).update("\0").update(map).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The debug ID a chunk already carries, from its trailing comment, a runtime
 * registration at its head, or its source map, in that order of precedence.
 */
export function existingDebugId(
  code: string,
  map: { debugId?: unknown; debug_id?: unknown },
): ExistingDebugId | null {
  const comment = COMMENT.exec(code.slice(-TAIL_LENGTH))?.[1];
  const head = code.slice(0, HEAD_LENGTH);
  const registrations = REGISTRATIONS.map((pattern) => pattern.exec(head)?.[1]).filter(
    (id): id is string => id !== undefined,
  );
  const fromMap = [map.debugId, map.debug_id].find(
    (id): id is string => typeof id === "string" && new RegExp(`^${UUID}$`).test(id),
  );
  const found = comment ?? registrations[0] ?? fromMap;
  if (found === undefined) {
    return null;
  }
  const debugId = found.toLowerCase();
  return {
    debugId,
    registered: registrations.some((id) => id.toLowerCase() === debugId),
    commented: comment !== undefined,
  };
}

/**
 * Registers the chunk's debug ID at runtime, keyed by a stack whose top frame
 * is this script, which is how `@vigilon/browser` maps a script URL to its ID.
 * ES5, one line, and it can never throw into the application.
 */
export function registrationSnippet(debugId: string): string {
  return (
    `;!function(){try{var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof window?window:` +
    `"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._vigilonDebugIds=e._vigilonDebugIds||{},e._vigilonDebugIds[n]="${debugId}")}catch(e){}}();`
  );
}
