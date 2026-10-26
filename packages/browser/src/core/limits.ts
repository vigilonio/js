/**
 * The event format's limits. Vigilon enforces them when it receives events;
 * the SDK applies the same caps first so that it truncates rather than being
 * rejected. String lengths count UTF-16 code units.
 */
export const LIMITS = {
  eventsPerRequest: 20,
  serviceNameLength: 100,
  serviceVersionLength: 200,
  exceptionTypeLength: 256,
  exceptionMessageLength: 8 * 1024,
  exceptionStackLength: 64 * 1024,
  exceptionStackLines: 250,
  componentStackLength: 16 * 1024,
  causeDepth: 5,
  debugIdEntries: 100,
  debugIdKeyLength: 2 * 1024,
  pageUrlLength: 2 * 1024,
  pageRouteLength: 200,
  identifierLength: 128,
  tagEntries: 20,
  tagKeyLength: 64,
  tagValueLength: 256,
} as const;

/** service.name and service.environment character set. */
export const SERVICE_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]+$/;

export const SCHEMA_ID = "vigilon.browser.event@1";
