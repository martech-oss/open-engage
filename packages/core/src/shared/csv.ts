/**
 * Quotes one CSV cell. Text a spreadsheet could read as a formula gets a `'`
 * prefix (CSV injection); spreadsheets skip leading whitespace and control
 * characters before recognising one, so those are looked past. Non-string
 * values are rendered as JSON. Shared by every CSV export so the client and
 * server cannot drift apart.
 */
export function csvCell(value: unknown): string {
  let rendered =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  // oxlint-disable-next-line eslint/no-control-regex
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(rendered)) rendered = `'${rendered}`;
  return `"${rendered.replaceAll('"', '""')}"`;
}
