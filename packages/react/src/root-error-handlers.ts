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
 * catch, and hydration mismatches are not reported.
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
      reportReactError(error, "react_recoverable", true, errorInfo.componentStack);
      (callbacks.onRecoverableError ?? logError)(error, errorInfo);
    },
  };
}

function logError(error: unknown): void {
  console.error(error);
}
