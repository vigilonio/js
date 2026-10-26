import { LIMITS } from "./limits";
import { scrubUrl, truncate } from "./text";

// Tag keys naming a credential are dropped. Vigilon drops them again when it
// receives an event.
const DENIED_TAG_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "api-key",
  "credential",
  "private_key",
];

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Applies the deny-list, the entry cap, and the key and value length caps. */
export function sanitizeTags(
  tags: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  let count = 0;
  for (const key of Object.keys(tags)) {
    if (count === LIMITS.tagEntries) {
      break;
    }
    const lowered = key.toLowerCase();
    if (
      key.length === 0 ||
      key.length > LIMITS.tagKeyLength ||
      DENIED_TAG_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment))
    ) {
      continue;
    }
    result[key] = truncate(String(tags[key]), LIMITS.tagValueLength);
    count += 1;
  }
  return result;
}

/**
 * An identifier (session, user, trace ID) over the cap is nulled rather than
 * truncated, because a truncated ID would silently join unrelated values.
 */
export function sanitizeIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= LIMITS.identifierLength
    ? value
    : null;
}

/** user.id must be an opaque ID: anything that looks like an email is dropped. */
export function sanitizeUserId(value: unknown): string | null {
  const id = sanitizeIdentifier(value);
  return id !== null && EMAIL_LIKE.test(id) ? null : id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Script URL to debug ID: scrubbed keys, UUID values, at most 100 entries. */
export function sanitizeDebugIds(
  debugIds: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  let count = 0;
  for (const [url, id] of Object.entries(debugIds)) {
    const key = scrubUrl(url);
    if (count === LIMITS.debugIdEntries) {
      break;
    }
    if (key.length > 0 && key.length <= LIMITS.debugIdKeyLength && UUID.test(String(id))) {
      result[key] = String(id);
      count += 1;
    }
  }
  return result;
}
