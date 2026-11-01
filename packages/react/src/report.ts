import { captureException, type ExceptionMechanism } from "@vigilon/browser";

// React 19 hands one caught error to both the root's onCaughtError and the
// boundary's componentDidCatch, root first. Whichever sees it first reports
// it; the other gets the same event ID back, so an error is sent once and a
// boundary's fallback still learns its event ID.
const reported = new WeakMap<object, string | null>();

export function reportReactError(
  error: unknown,
  mechanism: ExceptionMechanism,
  handled: boolean,
  componentStack: string | null | undefined,
): string | null {
  const key = typeof error === "object" && error !== null ? error : null;
  if (key !== null && reported.has(key)) {
    return reported.get(key) ?? null;
  }
  const eventId = captureException(error, {
    mechanism,
    handled,
    ...(componentStack ? { componentStack } : {}),
  });
  if (key !== null) {
    reported.set(key, eventId);
  }
  return eventId;
}
