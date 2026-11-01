import { reportReactError } from "./report";

export interface RootErrorInfo {
  componentStack?: string | null;
}

export interface RootErrorCallbacks {
  onUncaughtError?: (error: unknown, errorInfo: RootErrorInfo) => void;
  onCaughtError?: (error: unknown, errorInfo: RootErrorInfo) => void;
  onRecoverableError?: (error: unknown, errorInfo: RootErrorInfo) => void;
}

/**
 * The React 19 root error options for `createRoot` and `hydrateRoot`. React
 * reports render errors through these rather than the window `error` event,
 * so without them uncaught render errors, errors your own error boundaries
 * catch, and hydration mismatches are not reported. When React recovered by
 * rendering again and wrapped the thrown error in one of its own, the thrown
 * error is reported.
 *
 * Each handler reports the error, then calls your callback for that option.
 * Without one it logs the error with `console.error`, since passing an option
 * replaces React's own logging.
 *
 * ```ts
 * createRoot(container, rootErrorHandlers()).render(<App />);
 * ```
 */
export function rootErrorHandlers(callbacks: RootErrorCallbacks = {}): Required<RootErrorCallbacks> {
  return {
    onUncaughtError: (error, errorInfo) => {
      reportReactError(error, "react_uncaught", false, errorInfo.componentStack);
      (callbacks.onUncaughtError ?? logError)(error, errorInfo);
    },
    onCaughtError: (error, errorInfo) => {
      reportReactError(error, "react_error_boundary", true, errorInfo.componentStack);
      (callbacks.onCaughtError ?? logError)(error, errorInfo);
    },
    onRecoverableError: (error, errorInfo) => {
      reportReactError(recoveredError(error), "react_recoverable", true, errorInfo.componentStack);
      (callbacks.onRecoverableError ?? logError)(error, errorInfo);
    },
  };
}

// React wraps an error it recovered from by rendering again in an error of
// its own, with the thrown error as its cause: "There was an error during
// concurrent rendering but React was able to recover..." (#520 in production
// builds) and the two "There was an error while hydrating..." variants (#422,
// #423). Reporting the wrapper would group every such error under React's
// message.
const RECOVERY_WRAPPER = /^Minified React error #(?:422|423|520)\b|but React was able to recover/;

/** The error a recoverable error report is about: the cause React wrapped, if any. */
function recoveredError(error: unknown): unknown {
  if (error instanceof Error && error.cause !== undefined && RECOVERY_WRAPPER.test(error.message)) {
    return error.cause;
  }
  return error;
}

function logError(error: unknown): void {
  console.error(error);
}
