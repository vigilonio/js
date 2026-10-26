/*
 * Wire types for vigilon.browser.event@1. They mirror the vendored JSON Schema
 * in contract/v1, and the conformance tests check that every valid contract
 * fixture type-checks against them.
 */

export type ExceptionMechanism =
  | "onerror"
  | "unhandledrejection"
  | "manual"
  | "react_error_boundary"
  | "react_uncaught"
  | "react_recoverable"
  | "next_global_error";

export interface ExceptionCause {
  type: string;
  message: string;
  stack?: string | null;
}

export interface BrowserException {
  type: string;
  message: string;
  /** error.stack, unparsed, with the URL scrub applied. */
  stack: string | null;
  mechanism: ExceptionMechanism;
  handled: boolean;
  componentStack?: string | null;
  cause?: ExceptionCause[];
}

export interface BrowserEvent {
  type: "exception";
  eventId: string;
  timestamp: string;
  exception: BrowserException;
  debugIds?: Record<string, string>;
  page: { url: string; route?: string | null };
  session?: { id: string } | null;
  user?: { id: string } | null;
  traceId?: string | null;
  tags?: Record<string, string>;
}

export interface BrowserEventEnvelope {
  schema: "vigilon.browser.event@1";
  sdk: { name: string; version: string };
  sentAt: string;
  service: { name: string; version?: string; environment: string };
  events: BrowserEvent[];
}
