/**
 * @vigilon/react: error monitoring for React applications, on top of
 * @vigilon/browser, whose API it re-exports. Install this package alone; it
 * pins the matching @vigilon/browser.
 */
export * from "@vigilon/browser";
export {
  ErrorBoundary,
  type ErrorBoundaryProps,
  type FallbackProps,
} from "./error-boundary";
export {
  rootErrorHandlers,
  type RootErrorCallbacks,
  type RootErrorInfo,
} from "./root-error-handlers";
