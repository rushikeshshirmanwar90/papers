// Turns the raw explanation text pulled out of a solutions PDF into something
// presentable. Mirrors /shared/explanation.ts (kept in sync manually — this
// copy lets /web build standalone; /mobile still imports the original at
// /shared/explanation.ts). The source text carries three quirks worth handling:
//   1. it opens with the correct option in parentheses — "(B) The maximum ..."
//   2. many are written as numbered steps — "1 . For the first 3 s ..."
//   3. lines break wherever the PDF column ended, mid-sentence, and the pieces
//      of stacked fractions land on their own lines ("2 g")
// So we lift the answer letter out, group numbered steps, rejoin wrapped prose
// into sentences, and tag the leftover symbol-only fragments as maths so the UI
// can style them instead of letting them break up the prose.

export type ExplanationChunk = { kind: "text" | "math"; value: string };

export type ExplanationBlock =
  | { kind: "step"; label: string; chunks: ExplanationChunk[] }
  | { kind: "para"; chunks: ExplanationChunk[] };

export interface ParsedExplanation {
  /** The option letter the explanation opens with, if it stated one. */
  answerLetter: string | null;
  blocks: ExplanationBlock[];
}

const STEP_RE = /^(\d{1,2})\s*\.\s+(.*)$/;

/** A line that is essentially symbols and numbers — a stray piece of a formula. */
function isMathLine(line: string): boolean {
  const compact = line.replace(/\s/g, "");
  if (!compact) return false;
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  const digits = (compact.match(/\d/g) ?? []).length;
  if (compact.length <= 4) return digits > 0 || letters === 0;
  return letters / compact.length <= 0.4;
}

export function parseExplanation(raw: string): ParsedExplanation {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let answerLetter: string | null = null;
  if (lines.length > 0) {
    const m = lines[0].match(/^\(\s*([A-Da-d])\s*\)\s*(.*)$/);
    if (m) {
      answerLetter = m[1].toUpperCase();
      lines[0] = m[2];
      if (!lines[0]) lines.shift();
    }
  }

  const blocks: ExplanationBlock[] = [];
  const currentBlock = (): ExplanationBlock | undefined => blocks[blocks.length - 1];

  const pushChunk = (chunk: ExplanationChunk) => {
    let block = currentBlock();
    if (!block) {
      block = { kind: "para", chunks: [] };
      blocks.push(block);
    }
    const last = block.chunks[block.chunks.length - 1];
    // Rejoin prose split across PDF line breaks rather than showing it ragged.
    if (last && last.kind === "text" && chunk.kind === "text") {
      last.value = `${last.value} ${chunk.value}`.replace(/\s+/g, " ");
    } else {
      block.chunks.push(chunk);
    }
  };

  const endsSentence = () => {
    const block = currentBlock();
    if (!block) return false;
    for (let i = block.chunks.length - 1; i >= 0; i--) {
      const chunk = block.chunks[i];
      if (chunk.kind === "text") return /[.:;]$/.test(chunk.value.trim());
    }
    return false;
  };

  for (const line of lines) {
    const step = line.match(STEP_RE);
    if (step) {
      blocks.push({ kind: "step", label: step[1], chunks: [] });
      if (step[2]) pushChunk({ kind: isMathLine(step[2]) ? "math" : "text", value: step[2] });
      continue;
    }

    if (isMathLine(line)) {
      pushChunk({ kind: "math", value: line });
      continue;
    }

    // Inside a step everything belongs to that step. Outside one, a capitalised
    // line following a finished sentence starts a fresh paragraph.
    const startsNewSentence = /^[A-Z(]/.test(line);
    if (currentBlock()?.kind !== "step" && startsNewSentence && endsSentence()) {
      blocks.push({ kind: "para", chunks: [] });
    }
    pushChunk({ kind: "text", value: line });
  }

  return { answerLetter, blocks: blocks.filter((b) => b.chunks.length > 0) };
}
