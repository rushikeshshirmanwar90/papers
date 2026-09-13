// Turns the line-by-line solution text recovered from a TeX-typeset PDF into
// the paragraph form the Explanation component renders: prose paragraphs
// with inline \( \) maths, and full lines of working as \[ \] display maths.
//
// The PDF's lines break wherever its column ended, often mid-formula
// ("... = \) / \( \dfrac{...}"), so runs of maths that were split by a line
// break are stitched back together before paragraphs are formed.

const ENDS_OPEN = /[=+\-−×(,]\s*$|\\(?:cdot|times|Rightarrow|Longrightarrow|le|ge|ne)\s*$/;
const STARTS_OPEN = /^\s*(?:[=+\-−×)]|\\(?:cdot|times|Rightarrow|Longrightarrow|le|ge|ne))/;

/** Cosmetic clean-up of prose recovered from the PDF (",then" → ", then"). */
export function tidyProse(text: string): string {
  return text
    .replace(/\s+([,.;:?!])/g, "$1")
    .replace(/([,;:])(?=[A-Za-z\\])/g, "$1 ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strips a leading "(B)" answer marker that solutions open with. */
export function stripAnswerMarker(text: string): { answer: string | null; text: string } {
  const m = text.match(/^\s*\(\s*([A-Da-d])\s*\)\s*/);
  if (!m) return { answer: null, text };
  return { answer: m[1].toUpperCase(), text: text.slice(m[0].length) };
}

/** Joins two consecutive lines, merging maths runs that a line break split. */
const LAST_RUN_RE = /\\\(((?:(?!\\\)).)*)\\\)\s*$/;

function joinLines(a: string, b: string): string {
  const aEnd = a.match(LAST_RUN_RE);
  const bStart = b.match(/^\s*\\\(((?:(?!\\\)).)*)\\\)/);
  if (aEnd && bStart && (ENDS_OPEN.test(aEnd[1]) || STARTS_OPEN.test(bStart[1]))) {
    const head = a.slice(0, aEnd.index);
    const tail = b.slice((bStart.index ?? 0) + bStart[0].length);
    return `${head}\\(${aEnd[1].trim()} ${bStart[1].trim()}\\)${tail}`;
  }
  return `${a} ${b}`;
}

export function formatTexExplanation(raw: string): string {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  // Stitch wrapped lines into logical lines: a line continues onto the next
  // unless it ends a sentence or clause.
  const logical: string[] = [];
  let cur = "";
  for (const line of lines) {
    cur = cur ? joinLines(cur, line) : line;
    const lastRun = cur.match(LAST_RUN_RE);
    const doneMath = lastRun !== null && !ENDS_OPEN.test(lastRun[1]);
    const doneProse = /[.:;!?]\s*$/.test(cur);
    if ((doneProse || doneMath) && !/[,]\s*$/.test(cur)) {
      logical.push(cur);
      cur = "";
    }
  }
  if (cur) logical.push(cur);

  // A logical line that is nothing but one maths run becomes display maths.
  const paragraphs = logical.map((l) => {
    const only = l.match(/^\s*\\\((.*)\\\)\s*([.,;:])?\s*$/);
    if (only && !/\\\)/.test(only[1])) return `\\[${only[1].trim()}\\]`;
    return tidyProse(l);
  });
  return paragraphs.join("\n\n");
}
