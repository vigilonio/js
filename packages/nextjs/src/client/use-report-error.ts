import { captureException } from "@vigilon/react";
import { useEffect } from "react";

/**
 * Reports the error an `error.tsx` or `global-error.tsx` boundary received.
 * Next.js creates the React root itself, so @vigilon/react's
 * rootErrorHandlers cannot be passed to it; this hook reports what those
 * boundaries catch instead.
 *
 * An error with a `digest` was thrown on the server (a Server Component or
 * Server Action). Next.js records it on the server's request span and hands
 * the browser only a redacted copy, so it is not reported again here.
 *
 * ```tsx
 * "use client";
 * export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
 *   useReportError(error);
 *   return <html><body><h2>Something went wrong.</h2></body></html>;
 * }
 * ```
 */
export function useReportError(error: unknown): void {
  useEffect(() => {
    if (isServerError(error)) {
      return;
    }
    captureException(error, { mechanism: "react_error_boundary", handled: true });
  }, [error]);
}

function isServerError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string"
  );
}
