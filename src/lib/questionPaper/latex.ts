// Mirrors pcmb-paper's src/shared/latex.ts, so a printed paper splits and
// repairs maths exactly as the app shows it on screen. Change both together.
//
// LaTeX parser, sanitizer, delimiter detector, and repair utility
//
// Detects LaTeX delimiters ($ ... $, $$ ... $$, \( ... \), \[ ... \]) as well as
// raw LaTeX commands (\frac, \sqrt, \vec, etc.) and splits text into plain and math pieces.

const DELIM_RE =
  /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;

// Common LaTeX math commands
const LATEX_CMD_RE =
  /\\(?:frac|sqrt|vec|hat|int|sum|prod|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|pi|sigma|phi|omega|rho|tau|psi|zeta|eta|xi|chi|iota|sin|cos|tan|cot|sec|csc|log|ln|lim|text|times|div|pm|mp|le|ge|neq|approx|equiv|sim|propto|infty|cdot|to|rightarrow|leftarrow|implies|iff|partial|nabla|over|bar|tilde|underline|mathbf|mathrm|mathit|mathcal|left|right|dots|circ|perp|angle|parallel)\b/;

/**
 * Sanitizes any control characters that may have been mangled by JS string escape sequences
 * (\f -> formfeed, \v -> vtab, \b -> backspace, \a -> alert, \r, \t, etc.)
 * and repairs missing backslashes and dangling dollar delimiters.
 */
export function normalizeLatex(text: string | undefined | null): string {
  if (!text) return '';

  let s = String(text);

  // 1. Repair JS control-character corruptions (when strings were authored with single backslashes)
  s = s
    .replace(/\x0crac/g, '\\frac')
    .replace(/\x0c/g, '\\f')
    .replace(/\x0barepsilon/g, '\\varepsilon')
    .replace(/\x0bec/g, '\\vec')
    .replace(/\x0b/g, '\\v')
    .replace(/\x07lpha/g, '\\alpha')
    .replace(/\x07/g, '\\a')
    .replace(/\x08eta/g, '\\beta')
    .replace(/\x08/g, '\\b')
    .replace(/\x09heta/g, '\\theta')
    .replace(/\x09imes/g, '\\times')
    .replace(/\x09an/g, '\\tan')
    .replace(/\x09ext/g, '\\text')
    .replace(/\x09o/g, '\\to')
    .replace(/\x0dho/g, '\\rho')
    .replace(/\x0dight/g, '\\right');

  // 2. Repair common stripped-backslash prefix corruptions (e.g. "`ac{", " rac{", "^ac{")
  s = s
    .replace(/[`'^\s]ac\{/g, '\\frac{')
    .replace(/(^|[^\\])\brac\{/g, '$1\\frac{')
    .replace(/(^|[^\\])\barepsilon\b/g, '$1\\varepsilon');

  // 3. Repair missing backslashes on obvious LaTeX commands (e.g. "frac{1}{2}" -> "\frac{1}{2}")
  s = s
    .replace(/(^|[^\\])\bfrac\{/g, '$1\\frac{')
    .replace(/(^|[^\\])\bsqrt\{/g, '$1\\sqrt{')
    .replace(/(^|[^\\])\bvarepsilon\b/g, '$1\\varepsilon')
    .replace(/(^|[^\\])\bhat\{/g, '$1\\hat{')
    .replace(/(^|[^\\])\bvec\{/g, '$1\\vec{')
    .replace(/(^|[^\\])\btext\{/g, '$1\\text{');

  // 4. Repair single dangling/unbalanced dollar delimiters
  // Case: ends with single $, no other $ (e.g. "\frac{1}{4\pi \varepsilon_0} \frac{2q}{a}$") -> wrap as "$...$"
  const dollarCount = (s.match(/\$/g) || []).length;
  if (dollarCount % 2 !== 0) {
    if (s.endsWith('$') && !s.startsWith('$')) {
      s = '$' + s;
    } else if (s.startsWith('$') && !s.endsWith('$')) {
      s = s + '$';
    }
  }

  return s;
}

/**
 * Returns true if text contains standard delimiters OR known LaTeX commands.
 */
export function hasLatex(text: string | undefined | null): boolean {
  if (!text) return false;
  const s = normalizeLatex(text);
  DELIM_RE.lastIndex = 0;
  if (DELIM_RE.test(s)) return true;
  return LATEX_CMD_RE.test(s);
}

export type LatexPiece =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean };

/**
 * Splits text into text and math pieces for KaTeX rendering.
 */
export function splitLatex(text: string): LatexPiece[] {
  const normalized = normalizeLatex(text);
  if (!normalized) return [];

  const pieces: LatexPiece[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  DELIM_RE.lastIndex = 0;
  while ((m = DELIM_RE.exec(normalized)) !== null) {
    if (m.index > last) {
      const textBefore = normalized.slice(last, m.index);
      if (textBefore) pieces.push({ kind: 'text', value: textBefore });
    }
    const display = m[1] !== undefined || m[2] !== undefined;
    let mathVal = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    // Clean any stray leading/trailing $ inside the extracted math block
    mathVal = mathVal.replace(/^\$+|\$+$/g, '').trim();
    if (mathVal) {
      pieces.push({
        kind: 'math',
        value: mathVal,
        display,
      });
    }
    last = DELIM_RE.lastIndex;
  }

  if (last < normalized.length) {
    let trailingText = normalized.slice(last);
    // If trailing text ends with a stray unescaped $, strip it
    if (trailingText.endsWith('$') && !trailingText.endsWith('\\$')) {
      trailingText = trailingText.slice(0, -1);
    }
    // Check if trailing text itself has undelimited raw LaTeX (e.g. \frac{1}{2})
    if (LATEX_CMD_RE.test(trailingText)) {
      pieces.push({ kind: 'math', value: trailingText.trim(), display: false });
    } else if (trailingText) {
      pieces.push({ kind: 'text', value: trailingText });
    }
  }

  // If no delimiters were found but raw LaTeX commands exist, wrap entire content as math
  if (pieces.length === 1 && pieces[0].kind === 'text' && LATEX_CMD_RE.test(pieces[0].value)) {
    return [{ kind: 'math', value: pieces[0].value.trim(), display: false }];
  }

  return pieces.length > 0 ? pieces : [{ kind: 'text', value: normalized }];
}
