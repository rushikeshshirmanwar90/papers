// Splits text into plain/superscript/accented segments so the web and mobile
// apps can render exponents raised and letter accents (vector arrows, unit-
// vector hats) properly positioned, without pulling in a full math-typesetting
// library.
//
// Accents (P⃗, î, ĵ, k̂) arrive as a base letter immediately followed by a
// Unicode combining mark (pdfMarks.ts merges them during extraction). Browsers
// and the default UI fonts used here don't reliably shape combining marks —
// the accent often renders as a separate floating glyph next to the letter
// instead of stacked above it. So rather than relying on the font to compose
// it, we pull the mark back out here as structured data and let each platform
// draw it as a small positioned overlay above the base letter instead.
export type AccentType = "vector" | "hat" | "tilde" | "acute" | "grave";

export interface MathSegment {
  text: string;
  sup: boolean;
  /** Set when this segment is a single base letter carrying an accent mark. */
  accent?: AccentType;
}

const ACCENT_TYPE: Record<string, AccentType> = {
  "⃗": "vector",
  "̂": "hat",
  "̃": "tilde",
  "́": "acute",
  "̀": "grave",
};

const EXPONENT_RE = /\^(\(-?[^()]*\)|-?\d+(?:\.\d+)?)/g;

function splitExponents(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  EXPONENT_RE.lastIndex = 0;
  while ((match = EXPONENT_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), sup: false });
    }
    const exponent = match[1];
    const stripped = exponent.startsWith("(") && exponent.endsWith(")") ? exponent.slice(1, -1) : exponent;
    segments.push({ text: stripped, sup: true });
    lastIndex = EXPONENT_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), sup: false });
  }

  return segments;
}

export function parseMathSegments(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const chars = Array.from(text);
  let buf = "";

  const flushBuf = () => {
    if (buf) {
      segments.push(...splitExponents(buf));
      buf = "";
    }
  };

  for (let i = 0; i < chars.length; i++) {
    const next = chars[i + 1];
    const accent = next ? ACCENT_TYPE[next] : undefined;
    if (accent) {
      flushBuf();
      segments.push({ text: chars[i], sup: false, accent });
      i++; // consume the combining mark
      continue;
    }
    buf += chars[i];
  }
  flushBuf();

  return segments;
}

// Fractions and roots (⟦num⁄den⟧, ⟦√radicand⟧) arrive as bracket-delimited
// markers — pdfStacks.ts reconstructs them from PDFs where the numerator,
// fraction bar, and denominator (or radical sign and radicand) were flattened
// into disconnected rows of text with no indication they belonged together.
// parseMathNodes turns that marker syntax into a small recursive tree so each
// platform can draw a real stacked fraction / radical overline instead of
// plain run-together text.
export type MathNode =
  | { kind: "plain"; segments: MathSegment[] }
  | { kind: "frac"; num: MathNode[]; den: MathNode[] }
  | { kind: "root"; radicand: MathNode[] };

const FRAC_OPEN = "⟦";
const FRAC_SEP = "⁄";
const FRAC_CLOSE = "⟧";
const ROOT_MARK = "√";

function findMatchingClose(text: string, openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < text.length; j++) {
    if (text[j] === FRAC_OPEN) depth++;
    else if (text[j] === FRAC_CLOSE) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function findTopLevelSep(text: string): number {
  let depth = 0;
  for (let j = 0; j < text.length; j++) {
    if (text[j] === FRAC_OPEN) depth++;
    else if (text[j] === FRAC_CLOSE) depth--;
    else if (text[j] === FRAC_SEP && depth === 0) return j;
  }
  return -1;
}

export function parseMathNodes(text: string): MathNode[] {
  const nodes: MathNode[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(FRAC_OPEN, i);
    if (open === -1) {
      if (i < text.length) nodes.push({ kind: "plain", segments: parseMathSegments(text.slice(i)) });
      break;
    }
    if (open > i) nodes.push({ kind: "plain", segments: parseMathSegments(text.slice(i, open)) });

    const close = findMatchingClose(text, open);
    if (close === -1) {
      // Unterminated marker (shouldn't happen from a well-formed extractor) —
      // fall back to showing it as plain text rather than dropping it.
      nodes.push({ kind: "plain", segments: parseMathSegments(text.slice(open)) });
      break;
    }

    const inner = text.slice(open + 1, close);
    if (inner.startsWith(ROOT_MARK)) {
      nodes.push({ kind: "root", radicand: parseMathNodes(inner.slice(ROOT_MARK.length)) });
    } else {
      const sepIdx = findTopLevelSep(inner);
      if (sepIdx === -1) {
        nodes.push({ kind: "plain", segments: parseMathSegments(inner) });
      } else {
        nodes.push({
          kind: "frac",
          num: parseMathNodes(inner.slice(0, sepIdx)),
          den: parseMathNodes(inner.slice(sepIdx + 1)),
        });
      }
    }
    i = close + 1;
  }
  return nodes;
}
