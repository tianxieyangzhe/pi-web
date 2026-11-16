export type Formula = { source: string; tex: string; display: boolean; complete: boolean };

function escaped(source: string, index: number) {
  let slashes = 0;
  while (index > 0 && source[--index] === "\\") slashes += 1;
  return slashes % 2 === 1;
}

// Protect formulas before Markdown sees underscores, pipes, or line breaks.
// Placeholders are scoped to this render and cannot collide with the input.
export function protectMath(source: string) {
  let prefix = "\uE000math";
  while (source.includes(prefix)) prefix += "x";
  const formulas = new Map<string, Formula>();
  let text = "";
  let index = 0;
  while (index < source.length) {
    if (index === 0 || source[index - 1] === "\n") {
      const fence = source.slice(index).match(/^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$)/);
      if (fence) {
        const closing = new RegExp(`^[ \\t]*${fence[1][0]}{${fence[1].length},}[ \\t]*$`, "gm");
        closing.lastIndex = index + fence[0].length;
        const match = closing.exec(source);
        const end = match ? match.index + match[0].length : source.length;
        text += source.slice(index, end);
        index = end;
        continue;
      }
    }
    if (source[index] === "`" && !escaped(source, index)) {
      const ticks = source.slice(index).match(/^`+/)![0];
      // Avoid escaped backticks in template literals: Next's production
      // minifier can emit them without escaping and break the server bundle.
      const closing = new RegExp("(?<!`)" + ticks + "(?!`)", "g");
      closing.lastIndex = index + ticks.length;
      const match = closing.exec(source);
      if (match) {
        const end = match.index + ticks.length;
        text += source.slice(index, end);
        index = end;
        continue;
      }
      text += ticks;
      index += ticks.length;
      continue;
    }

    const rest = source.slice(index);
    const opener = !escaped(source, index)
      ? rest.startsWith("\\[") ? "\\["
        : rest.startsWith("\\(") ? "\\("
          : rest.startsWith("$$") ? "$$"
            : rest.startsWith("$") && /\S/.test(rest[1] ?? "") ? "$" : null
      : null;
    if (!opener) { text += source[index++]; continue; }

    const closer = opener === "\\[" ? "\\]" : opener === "\\(" ? "\\)" : opener;
    const start = index + opener.length;
    let end = source.indexOf(closer, start);
    while (end >= 0 && (escaped(source, end)
      || opener === "$" && (/\s/.test(source[end - 1]) || /\d/.test(source[end + 1] ?? "") || source[end + 1] === "$"))) {
      end = source.indexOf(closer, end + closer.length);
    }
    const newline = source.indexOf("\n", start);
    if (opener === "$" && newline >= 0 && end > newline) end = -1;
    const complete = end >= 0;
    const stop = complete ? end + closer.length : opener === "$" && newline >= 0 ? newline : source.length;
    const key = `${prefix}${formulas.size}\uE001`;
    formulas.set(key, {
      source: source.slice(index, stop),
      tex: source.slice(start, complete ? end : stop),
      display: opener === "\\[" || opener === "$$",
      complete,
    });
    text += key;
    index = stop;
  }
  return { text, formulas, prefix };
}
