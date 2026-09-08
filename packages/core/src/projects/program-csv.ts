export type ProgramCsvRow =
  | { row: number; contactId?: string; email?: string; statusId?: string }
  | { row: number; error: string };
/** RFC4180 quotes/newlines are preserved; each data record gets its physical starting line. */
export function parseProgramMemberCsv(csv: string): ProgramCsvRow[] {
  const records: Array<{ row: number; cells: string[]; error?: string }> = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let start = 1;
  let error: string | undefined;
  const finish = () => {
    cells.push(value.trim());
    if (cells.some(Boolean) || error)
      records.push({ row: start, cells, ...(error ? { error } : {}) });
    cells = [];
    value = "";
    afterQuote = false;
    error = undefined;
    start = line + 1;
  };
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        value += char;
        if (char === "\n") line++;
      }
      continue;
    }
    if (char === '"' && !value && !afterQuote) {
      quoted = true;
      continue;
    }
    if (char === ",") {
      cells.push(value.trim());
      value = "";
      afterQuote = false;
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finish();
      line++;
      continue;
    }
    if (afterQuote && !/\s/.test(char)) error = "Unexpected text after closing quote";
    value += char;
  }
  if (quoted) error = "Unclosed quoted value";
  if (value || cells.length || error) finish();
  const header = records.shift();
  if (!header || header.error || !header.cells.some((c) => c === "contactId" || c === "email"))
    throw new Error("CSV header requires contactId or email");
  if (
    new Set(header.cells).size !== header.cells.length ||
    header.cells.some((c) => !["contactId", "email", "statusId"].includes(c))
  )
    throw new Error("CSV contains duplicate or unsupported columns");
  if (records.length > 1000) throw new Error("CSV supports at most 1000 rows");
  return records.map((record) => {
    if (record.error) return { row: record.row, error: record.error };
    if (record.cells.length !== header.cells.length)
      return { row: record.row, error: "Column count does not match header" };
    const values = Object.fromEntries(header.cells.map((key, i) => [key, record.cells[i]!]));
    if (!values["contactId"] && !values["email"])
      return { row: record.row, error: "Contact ID or email is required" };
    return { row: record.row, ...Object.fromEntries(Object.entries(values).filter(([, v]) => v)) };
  });
}
