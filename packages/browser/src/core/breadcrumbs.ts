import type { Breadcrumb, BreadcrumbCategory, BreadcrumbLevel } from "./envelope";
import { LIMITS } from "./limits";
import { isDeniedKey } from "./privacy";
import { scrubUrl, scrubUrlsInText, truncate } from "./text";

const CATEGORIES: readonly BreadcrumbCategory[] = [
  "navigation",
  "click",
  "console",
  "fetch",
  "xhr",
  "custom",
];
const LEVELS: readonly BreadcrumbLevel[] = ["debug", "info", "warning", "error"];

// Data values that hold one URL or path: navigation from/to and a request's url.
const URL_KEYS = ["url", "from", "to"];

/** The most recent breadcrumbs, oldest first. */
export class BreadcrumbBuffer {
  private readonly entries: Breadcrumb[] = [];

  constructor(private readonly capacity: number) {}

  add(breadcrumb: Breadcrumb): void {
    if (this.capacity <= 0) {
      return;
    }
    this.entries.push(breadcrumb);
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  snapshot(): Breadcrumb[] {
    return this.entries.slice();
  }
}

/**
 * Applies the event format's breadcrumb rules, last, after beforeSend. URLs are
 * scrubbed while their strings are whole (a cut through `user:password@` would
 * hide the `@` the scrub looks for), then strings are truncated and the oldest
 * entries dropped until the array fits its byte budget. Invalid entries are
 * dropped.
 */
export function sanitizeBreadcrumbs(breadcrumbs: unknown): Breadcrumb[] {
  if (!Array.isArray(breadcrumbs)) {
    return [];
  }
  const sanitized: Breadcrumb[] = [];
  for (const entry of breadcrumbs.slice(-LIMITS.breadcrumbEntries)) {
    const breadcrumb = sanitizeBreadcrumb(entry);
    if (breadcrumb !== null) {
      sanitized.push(breadcrumb);
    }
  }
  return fitBreadcrumbs(sanitized);
}

function sanitizeBreadcrumb(value: unknown): Breadcrumb | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const { timestamp, category, level, message, data } = entry;
  if (
    typeof timestamp !== "string" ||
    Number.isNaN(Date.parse(timestamp)) ||
    !CATEGORIES.includes(category as BreadcrumbCategory)
  ) {
    return null;
  }
  const breadcrumb: Breadcrumb = { timestamp, category: category as BreadcrumbCategory };
  if (LEVELS.includes(level as BreadcrumbLevel)) {
    breadcrumb.level = level as BreadcrumbLevel;
  }
  if (typeof message === "string" && message.length > 0) {
    breadcrumb.message = truncate(scrubUrlsInText(message), LIMITS.breadcrumbMessageLength);
  }
  if (typeof data === "object" && data !== null) {
    const sanitizedData: Record<string, string | number | boolean> = {};
    let count = 0;
    for (const [key, item] of Object.entries(data)) {
      if (count === LIMITS.breadcrumbDataEntries) {
        break;
      }
      if (key.length === 0 || key.length > LIMITS.breadcrumbDataKeyLength || isDeniedKey(key)) {
        continue;
      }
      if (typeof item === "string") {
        const scrubbed = URL_KEYS.includes(key) ? scrubUrl(item) : scrubUrlsInText(item);
        sanitizedData[key] = truncate(scrubbed, LIMITS.breadcrumbDataValueLength);
      } else if ((typeof item === "number" && Number.isFinite(item)) || typeof item === "boolean") {
        sanitizedData[key] = item;
      } else {
        continue;
      }
      count += 1;
    }
    if (count > 0) {
      breadcrumb.data = sanitizedData;
    }
  }
  return breadcrumb;
}

/** Drops the oldest entries until the array's JSON fits LIMITS.breadcrumbsBytes of UTF-8. */
function fitBreadcrumbs(breadcrumbs: Breadcrumb[]): Breadcrumb[] {
  const encoder = new TextEncoder();
  const sizes = breadcrumbs.map((entry) => encoder.encode(JSON.stringify(entry)).length);
  // "[" + entries joined by "," + "]"
  let total = 2 + sizes.reduce((sum, size) => sum + size, 0) + sizes.length - 1;
  let start = 0;
  while (start < breadcrumbs.length && total > LIMITS.breadcrumbsBytes) {
    total -= sizes[start] + (breadcrumbs.length - start > 1 ? 1 : 0);
    start += 1;
  }
  return breadcrumbs.slice(start);
}
