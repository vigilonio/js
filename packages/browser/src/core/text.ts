import { LIMITS } from "./limits";

/** Truncates to maxLength UTF-16 code units without splitting a surrogate pair. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const code = value.charCodeAt(maxLength - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? maxLength - 1 : maxLength;
  return value.slice(0, end);
}

/** Truncated from the bottom: line cap first, then length cap. */
export function truncateStack(stack: string): string {
  const lines = stack.split("\n");
  const kept =
    lines.length > LIMITS.exceptionStackLines
      ? lines.slice(0, LIMITS.exceptionStackLines).join("\n")
      : stack;
  return truncate(kept, LIMITS.exceptionStackLength);
}

/*
 * The URL scrub: remove the query string, the fragment, and any
 * user:password@ userinfo. Vigilon applies the same scrub again when it
 * receives an event, so a stack scrubbed here is left unchanged there.
 */
const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#@\s]*@/i;
// A URL inside free text: scheme:// up to the next whitespace.
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
// A stack frame's :line:column and closing punctuation survive the scrub.
const TRAILER = /(:\d+:\d+)?([)\]}>"',;.]*)$/;

/** Scrubs one URL. */
export function scrubUrl(value: string): string {
  const url = value.replace(USERINFO, "$1");
  const query = url.indexOf("?");
  const fragment = url.indexOf("#");
  const cut =
    query === -1 ? fragment : fragment === -1 ? query : Math.min(query, fragment);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Scrubs every URL inside free text, keeping a stack frame parseable. */
export function scrubUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (token) => {
    const trailer = TRAILER.exec(token)?.[0] ?? "";
    return scrubUrl(token.slice(0, token.length - trailer.length)) + trailer;
  });
}
