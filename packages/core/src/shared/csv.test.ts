import { describe, expect, it } from "vitest";

import { csvCell } from "./csv";

describe("csvCell", () => {
  it.each([
    ["no prefix", ""],
    ["spaces", "  "],
    ["tab", "\t"],
    ["carriage return", "\r"],
    ["line feed", "\n"],
    ["non-breaking space", "\u00a0"],
    ["Unicode space", "\u2003"],
    ["BOM", "\ufeff"],
    ["C0 controls", "\u0000\u0001\u001f"],
    ["DEL and C1 controls", "\u007f\u0080\u0085\u009f"],
    ["mixed whitespace and controls", " \t\r\n\ufeff\u001f\u0085"],
  ])("neutralizes each formula marker after %s without dropping its prefix", (_label, prefix) => {
    for (const marker of ["=", "+", "-", "@"]) {
      const value = `${prefix}${marker}1+1`;
      expect(csvCell(value)).toBe(`"'${value}"`);
    }
  });

  it("escapes quotes and commas after neutralizing a formula", () => {
    expect(csvCell('\t=HYPERLINK("https://example.com","label")')).toBe(
      '"\'\t=HYPERLINK(""https://example.com"",""label"")"',
    );
  });

  it.each([
    "ordinary text",
    "  padded text  ",
    "\tordinary text",
    "\rordinary text",
    "\nordinary text",
    "\u0001ordinary text",
    "\u0085ordinary text",
    "\ufeffordinary text",
    " \t\r\n",
    "text =1+1",
    "first line\n=second line",
    "'=1+1",
    " \t'=1+1",
  ])("preserves non-formula text %j", (value) => {
    expect(csvCell(value)).toBe(`"${value}"`);
  });

  it("preserves CSV escaping for ordinary text with quotes, commas, and newlines", () => {
    expect(csvCell('Ada "Quoted",\nLine')).toBe('"Ada ""Quoted"",\nLine"');
  });

  it.each([
    [null, '""'],
    [undefined, '""'],
    ["", '""'],
    [0, '"0"'],
    [42, '"42"'],
    [-42, '"\'-42"'],
    [false, '"false"'],
    [{ label: "=1+1" }, '"{""label"":""=1+1""}"'],
    [["@name", 1], '"[""@name"",1]"'],
  ])("retains rendering for non-string or empty value %j", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});
