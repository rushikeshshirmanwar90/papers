import katex from "katex";

// Renders text that carries LaTeX maths in the usual delimiters —
// \( … \) or $ … $ inline, \[ … \] or $$ … $$ display — with KaTeX. Anything
// outside a delimiter is emitted as plain text. Used for hand-authored
// questions (see scripts/data/*.json); questions pulled straight out of a PDF
// don't contain delimiters and keep going through MathText's own parser.

const DELIM_RE = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

export function hasLatex(text: string | undefined | null): boolean {
  if (!text) return false;
  DELIM_RE.lastIndex = 0;
  return DELIM_RE.test(text);
}

type Piece = { kind: "text"; value: string } | { kind: "math"; value: string; display: boolean };

export function splitLatex(text: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  DELIM_RE.lastIndex = 0;
  while ((m = DELIM_RE.exec(text)) !== null) {
    if (m.index > last) pieces.push({ kind: "text", value: text.slice(last, m.index) });
    const display = m[1] !== undefined || m[2] !== undefined;
    pieces.push({ kind: "math", value: (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), display });
    last = DELIM_RE.lastIndex;
  }
  if (last < text.length) pieces.push({ kind: "text", value: text.slice(last) });
  return pieces;
}

function Formula({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    strict: "ignore",
    output: "htmlAndMathml",
  });
  return display ? (
    <span className="katex-block" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function Latex({ text }: { text: string }) {
  return (
    <>
      {splitLatex(text).map((p, i) =>
        p.kind === "math" ? <Formula key={i} tex={p.value} display={p.display} /> : <span key={i}>{p.value}</span>
      )}
    </>
  );
}
