// Where a long formula may be broken over lines, as a typesetter would: after
// a relation (=, <, >, \le …) or a binary operator (+, -, \times …) written at
// the top level of the formula. Never inside a group {…}, a \left…\right pair,
// brackets or an environment (matrix, cases …), so fractions, roots and
// matrices are always kept whole.

/** Commands that are relations or binary operators; a line may end after one. */
const BREAK_AFTER = new Set([
  "times", "cdot", "pm", "mp", "div", "ast", "star", "circ", "cup", "cap", "oplus", "otimes",
  "le", "leq", "ge", "geq", "ne", "neq", "ll", "gg", "approx", "equiv", "sim", "simeq", "cong", "propto",
  "in", "notin", "subset", "subseteq", "supset", "supseteq", "perp", "parallel",
  "to", "gets", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow", "Leftrightarrow",
  "implies", "impliedby", "iff", "mapsto",
]);
/** Spacing commands; a line may end after one. */
const BREAK_SPACE = new Set(["quad", "qquad"]);

/** What the last thing read was, to tell a binary minus from a sign. */
type Last = "start" | "operand" | "operator";

/** Positions in the source after which a break is allowed, ascending. */
export function breakPoints(source: string): number[] {
  const cuts: number[] = [];
  let braces = 0;
  let brackets = 0;
  let left = 0;
  let envs = 0;
  let last: Last = "start";
  // Right after ^ or _, where a sign belongs to the exponent: x^-1.
  let script = false;
  let i = 0;

  /** The delimiter after \left or \right: ( [ . | or a command like \{ or \langle. */
  const skipDelimiter = (from: number) => {
    let j = from;
    while (source[j] === " ") j++;
    if (source[j] === "\\") {
      j++;
      if (/[a-zA-Z]/.test(source[j] ?? "")) while (/[a-zA-Z]/.test(source[j] ?? "")) j++;
      else j++;
      return j;
    }
    return Math.min(j + 1, source.length);
  };

  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const open = braces === 0 && brackets === 0 && left === 0 && envs === 0;

    if (ch === "\\") {
      let j = i + 1;
      if (/[a-zA-Z]/.test(source[j] ?? "")) while (/[a-zA-Z]/.test(source[j] ?? "")) j++;
      else j++;
      const name = source.slice(i + 1, j);
      if (name === "left") {
        left++;
        i = skipDelimiter(j);
        last = "start";
      } else if (name === "right") {
        left = Math.max(0, left - 1);
        i = skipDelimiter(j);
        last = "operand";
      } else if (name === "begin") {
        envs++;
        i = j;
        last = "start";
      } else if (name === "end") {
        envs = Math.max(0, envs - 1);
        i = j;
        last = "operand";
      } else if (name === "sqrt" && source[j] === "[") {
        // \sqrt[3]{x}: the index is part of the root.
        const close = source.indexOf("]", j);
        i = close < 0 ? j : close + 1;
        last = "start";
      } else if (BREAK_AFTER.has(name)) {
        i = j;
        if (open && !script && last === "operand") cuts.push(i);
        last = "operator";
      } else if (BREAK_SPACE.has(name)) {
        i = j;
        if (open && last === "operand") cuts.push(i);
      } else {
        i = j;
        last = "operand";
      }
      script = false;
      continue;
    }

    i++;
    switch (ch) {
      case "{":
        braces++;
        last = "start";
        script = false;
        break;
      case "}":
        braces = Math.max(0, braces - 1);
        last = "operand";
        break;
      case "(":
      case "[":
        brackets++;
        last = "start";
        script = false;
        break;
      case ")":
      case "]":
        brackets = Math.max(0, brackets - 1);
        last = "operand";
        break;
      case "^":
      case "_":
        script = true;
        break;
      case "=":
      case "<":
      case ">":
        if (open && !script && last === "operand") cuts.push(i);
        last = "operator";
        script = false;
        break;
      case "+":
      case "-":
        // Binary only after something to add to; otherwise a sign.
        if (open && !script && last === "operand") cuts.push(i);
        last = "operator";
        script = false;
        break;
      case ",":
      case ";":
      case ":":
        last = "operator";
        script = false;
        break;
      default:
        last = "operand";
        script = false;
    }
  }
  return cuts;
}

/** Roughly how wide a formula prints: its source with each command (\sigma, \frac) as one glyph and no markup. */
const visibleLength = (tex: string) => tex.replace(/\\[a-zA-Z]+/g, "x").replace(/[\\{}^_$\s]/g, "").length;

/** Formulas shorter than this are never split. */
const SPLIT_FROM = 22;

/**
 * The formula cut into pieces a line may end between; one piece when it is
 * short or has nowhere valid to break. Every piece is a complete formula on
 * its own (balanced groups), and the pieces joined give the original.
 */
export function splitMath(source: string): string[] {
  if (visibleLength(source) < SPLIT_FROM) return [source];
  const pieces: string[] = [];
  let from = 0;
  for (const cut of breakPoints(source)) {
    if (cut >= source.length) continue;
    const piece = source.slice(from, cut).trim();
    if (piece) pieces.push(piece);
    from = cut;
  }
  const rest = source.slice(from).trim();
  if (rest) pieces.push(rest);
  return pieces.length ? pieces : [source];
}
