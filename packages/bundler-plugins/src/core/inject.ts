import { debugIdFor, existingDebugId, registrationSnippet } from "./debug-id";
import { insertLines } from "./source-map";

interface RawSourceMap {
  mappings?: unknown;
  debugId?: unknown;
  debug_id?: unknown;
  [field: string]: unknown;
}

export interface InjectedChunk {
  code: string;
  map: string;
  debugId: string;
  /** The ID came from the chunk or its map instead of being derived here. */
  reused: boolean;
}

const DIRECTIVE = /^(["'])use [a-z ]+\1\s*;/;
// Trailing `//# sourceMappingURL=` and similar comment lines.
const TRAILING_COMMENTS = /\n(?:\/\/[#@][^\n]*\s*)+$/;

/**
 * Gives one emitted chunk exactly one debug ID: the one it already carries,
 * or one derived from its content. Adds the runtime registration when no
 * registry the SDK reads has it, the `//# debugId=` comment when missing, and
 * `debugId` to the map, adjusting the map's mappings for every inserted line.
 * Throws when the map is not a plain (non-indexed) source map.
 */
export function injectDebugId(code: string, mapSource: string): InjectedChunk {
  const map = JSON.parse(mapSource) as RawSourceMap;
  if (typeof map !== "object" || map === null || typeof map.mappings !== "string") {
    throw new Error("not a source map with a mappings string (indexed maps are not supported)");
  }
  let mappings = map.mappings;
  const existing = existingDebugId(code, map);
  const debugId = existing?.debugId ?? debugIdFor(code, mapSource);

  let output = code;
  if (!existing?.registered) {
    const offset = prologueLength(output);
    const { line, column } = positionOf(output, offset);
    // Mid-line (after a directive on a minified first line), the snippet
    // gets its own line so the rest of that line keeps its columns exact.
    const text = `${column > 0 ? "\n" : ""}${registrationSnippet(debugId)}\n`;
    output = output.slice(0, offset) + text + output.slice(offset);
    mappings = insertLines(mappings, line, column, column > 0 ? 2 : 1);
  }
  if (!existing?.commented) {
    const comment = `//# debugId=${debugId}`;
    const trailing = TRAILING_COMMENTS.exec(output);
    if (trailing) {
      // Before the sourceMappingURL comment, on a line of its own.
      const offset = trailing.index + 1;
      mappings = insertLines(mappings, positionOf(output, offset).line, 0, 1);
      output = `${output.slice(0, offset)}${comment}\n${output.slice(offset)}`;
    } else {
      output = `${output}${output.endsWith("\n") ? "" : "\n"}${comment}\n`;
    }
  }
  const { debug_id: _legacy, ...rest } = map;
  return {
    code: output,
    map: JSON.stringify({ ...rest, mappings, debugId }),
    debugId,
    reused: existing !== null,
  };
}

/**
 * Where code may be inserted at the top of a script without changing its
 * meaning: after a hashbang and any directives such as "use strict".
 */
function prologueLength(code: string): number {
  let index = 0;
  let end = 0;
  if (code.startsWith("#!")) {
    const newline = code.indexOf("\n");
    if (newline === -1) {
      return code.length;
    }
    index = end = newline + 1;
  }
  while (index < code.length) {
    const char = code[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      index += 1;
    } else if (code.startsWith("/*", index)) {
      const close = code.indexOf("*/", index + 2);
      if (close === -1) {
        break;
      }
      index = close + 2;
    } else if (code.startsWith("//", index)) {
      const newline = code.indexOf("\n", index);
      index = newline === -1 ? code.length : newline + 1;
    } else {
      const directive = DIRECTIVE.exec(code.slice(index, index + 64));
      if (!directive) {
        break;
      }
      index = end = index + directive[0].length;
    }
  }
  return end;
}

function positionOf(code: string, offset: number): { line: number; column: number } {
  let line = 0;
  let lineStart = 0;
  for (let index = code.indexOf("\n"); index !== -1 && index < offset; index = code.indexOf("\n", index + 1)) {
    line += 1;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart };
}
