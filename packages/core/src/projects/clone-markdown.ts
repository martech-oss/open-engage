/** Rewrite link destinations only. Code, labels, and ordinary prose remain literal. */
export function rewriteCloneMarkdown(
  markdown: string,
  rewriteUrl: (url: string) => string,
): string {
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const brackets: number[] = [];
  const destination = (start: number) => {
    const angle = markdown[start] === "<";
    const from = start + Number(angle);
    let end = from,
      depth = 0;
    for (; end < markdown.length; end++) {
      const char = markdown[end];
      if (char === "\\") {
        end++;
        continue;
      }
      if (angle ? char === ">" || char === "\n" : /\s/.test(char!)) break;
      if (!angle && char === "(") depth++;
      if (!angle && char === ")" && depth-- === 0) break;
    }
    if (angle && markdown[end] !== ">") return null;
    return { start: from, end, after: end + Number(angle) };
  };
  const record = (target: { start: number; end: number }) => {
    const original = markdown.slice(target.start, target.end);
    const value = rewriteUrl(original);
    if (value !== original) edits.push({ ...target, value });
  };
  for (let i = 0; i < markdown.length; i++) {
    if (i === 0 || markdown[i - 1] === "\n") {
      const rest = markdown.slice(i);
      const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(rest);
      if (fence) {
        const close = new RegExp(
          `^ {0,3}${fence[1]![0]}{${fence[1]!.length},}[ \\t]*(?:\\n|$)`,
          "gm",
        );
        close.lastIndex = i + fence[0].length;
        const end = close.exec(markdown);
        i = end ? end.index + end[0].length - 1 : markdown.length;
        brackets.length = 0;
        continue;
      }
      if (/^(?: {4}|\t)/.test(rest)) {
        const end = markdown.indexOf("\n", i);
        i = end < 0 ? markdown.length : end;
        continue;
      }
      const reference = /^ {0,3}\[(?:\\.|[^\]\\\n])+\]:[ \t]*/.exec(rest);
      if (reference) {
        const target = destination(i + reference[0].length);
        if (target) {
          record(target);
          i = target.after - 1;
          continue;
        }
      }
    }
    if (markdown[i] === "\\") {
      i++;
      continue;
    }
    if (markdown[i] === "`") {
      const run = /^`+/.exec(markdown.slice(i))![0];
      const close = new RegExp(`(?<!\u0060)\u0060{${run.length}}(?!\u0060)`, "g");
      close.lastIndex = i + run.length;
      const end = close.exec(markdown);
      i = end ? end.index + run.length - 1 : i + run.length - 1;
      continue;
    }
    if (markdown[i] === "[") brackets.push(i);
    if (markdown[i] !== "]" || !brackets.length) continue;
    brackets.pop();
    const opening = /^\([ \t\n]*/.exec(markdown.slice(i + 1));
    if (!opening) continue;
    const target = destination(i + 1 + opening[0].length);
    if (!target) continue;
    const closing = /^[ \t\n]*(?:(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t\n]*)?\)/.exec(
      markdown.slice(target.after),
    );
    if (closing) {
      record(target);
      i = target.after + closing[0].length - 1;
    }
  }
  let result = "",
    offset = 0;
  for (const edit of edits) {
    result += markdown.slice(offset, edit.start) + edit.value;
    offset = edit.end;
  }
  return result + markdown.slice(offset);
}
