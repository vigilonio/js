/*
 * Just enough of the source map v3 `mappings` format to keep a map exact when
 * whole lines are inserted into the generated file. Every field of a segment
 * except the generated column is relative to the previous segment in the
 * whole map, and the generated column is relative only within its line, so
 * splitting a line changes nothing but the first generated column of the
 * moved part.
 */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((char, index) => [char, index]));

function decodeSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = DIGIT.get(char);
    if (digit === undefined) {
      throw new Error(`invalid source map mappings character: ${char}`);
    }
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

function encodeSegment(values: number[]): string {
  let encoded = "";
  for (const signed of values) {
    let value = signed < 0 ? (-signed << 1) | 1 : signed << 1;
    do {
      let digit = value & 31;
      value >>>= 5;
      if (value > 0) {
        digit |= 32;
      }
      encoded += BASE64[digit];
    } while (value > 0);
  }
  return encoded;
}

/**
 * Adjusts `mappings` for text inserted at a zero-based `line` and `column` of
 * the generated file, where the text holds `lineCount` newlines and ends with
 * one, so the original content from `column` onward starts a later line.
 */
export function insertLines(
  mappings: string,
  line: number,
  column: number,
  lineCount: number,
): string {
  const lines = mappings.split(";");
  if (line >= lines.length) {
    return mappings;
  }
  const before: string[] = [];
  const after: string[] = [];
  let generatedColumn = 0;
  for (const segment of lines[line] === "" ? [] : lines[line].split(",")) {
    const values = decodeSegment(segment);
    generatedColumn += values[0];
    if (generatedColumn < column) {
      before.push(segment);
    } else if (after.length === 0) {
      // The first moved segment's column becomes absolute on its new line.
      after.push(encodeSegment([generatedColumn - column, ...values.slice(1)]));
    } else {
      after.push(segment);
    }
  }
  return [
    ...lines.slice(0, line),
    before.join(","),
    ...Array<string>(lineCount - 1).fill(""),
    after.join(","),
    ...lines.slice(line + 1),
  ].join(";");
}
