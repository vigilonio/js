import { uuid } from "../core/uuid";

const SESSION_KEY = "vigilon.session";

/**
 * A random ID kept in sessionStorage, so one per tab and never a cookie.
 * Without storage (privacy modes, sandboxed iframes) it is null, and each
 * event then counts as its own session.
 */
export function sessionId(): string | null {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      return existing;
    }
    const created = uuid();
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}
