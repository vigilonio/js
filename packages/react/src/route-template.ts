/** Drops a trailing slash, so `/settings/` and `/settings` are one page. */
export function normalizeTemplate(template: string): string {
  const trimmed = template.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}
