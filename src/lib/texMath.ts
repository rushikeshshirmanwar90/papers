// Rebuilds typeset mathematics from a PDF's raw geometry and writes it out as
// LaTeX (rendered later by KaTeX in <MathText>).
//
// A PDF has no notion of "fraction" or "root": a TeX-generated page is just
// glyphs at (x, y) in a handful of fonts plus a few thin stroked lines. What
// it does keep, exactly, is the geometry TeX used to lay the maths out:
//
//   fraction   a horizontal rule; the numerator's glyphs sit just above it
//              and the denominator's just below, both inside the rule's span
//   root       a "√" glyph whose right edge meets a rule (the vinculum); the
//              radicand sits under that rule
//   exponent   a smaller glyph whose baseline is raised above its neighbours
//   subscript  the same, lowered
//   big ( ) Σ  delimiters and operators from the CMEX font, hung from a
//              reference point above the baseline
//
// So the reconstruction works bottom-up from the rules: the narrowest rule is
// the innermost fraction, and each rule claims the glyphs (or already-built
// nodes) directly above and below it inside its span. Whatever is left is
// ordinary line text, in which raised/lowered small glyphs become ^{} / _{}.
// Fonts tell text from maths: Computer Modern glyphs (CMR/CMMI/CMSY/CMEX) are
// maths, anything else is prose, so each line comes out as prose with \( \)
// runs embedded — the same shape as the hand-authored papers.

export type FontClass = "text" | "cmr" | "cmmi" | "cmsy" | "cmex";

export interface Glyph {
  str: string;
  x: number;
  endX: number;
  /** Baseline (PDF user space, y grows upwards). */
  y: number;
  size: number;
  font: FontClass;
}

export interface Rule {
  x1: number;
  x2: number;
  y: number;
}

export interface LineOut {
  y: number;
  text: string;
  fragments: { text: string; x: number; endX: number }[];
}

// ---------------------------------------------------------------------------
// Items: glyphs and the fraction / root nodes assembled from them.

interface BaseItem {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
  baseline: number;
  size: number;
  claimed: boolean;
}
interface GlyphItem extends BaseItem {
  kind: "glyph";
  g: Glyph;
}
interface FracItem extends BaseItem {
  kind: "frac";
  num: Item[];
  den: Item[];
}
interface SqrtItem extends BaseItem {
  kind: "sqrt";
  radicand: Item[];
}
interface BigOpItem extends BaseItem {
  kind: "bigop";
  g: Glyph;
  upper: Item[];
  lower: Item[];
}
interface AccentItem extends BaseItem {
  kind: "accent";
  /** LaTeX command, e.g. "\\overrightarrow". */
  cmd: string;
  base: Item[];
}
type Item = GlyphItem | FracItem | SqrtItem | BigOpItem | AccentItem;

const CM_ASCENT = 0.694; // cap height / digit height, in em
const CM_XHEIGHT = 0.43;
const CM_DESCENT = 0.194;
const AXIS = 0.25; // maths axis above the baseline, in em (where fraction bars sit)

const TALL_CHARS = /[A-Z0-9bdfhklt()[\]{}|/\\!?βδζθλξΓΔΘΛΞΠΣΦΨΩ√∑∏∫]/;
const DESCENDER_CHARS = /[gjpqy()[\]{}|/\\,;βγζημξρςφχψ∫]/;

function glyphItem(g: Glyph): GlyphItem {
  const text = g.str;
  let top: number;
  let bottom: number;
  if (text === "√") {
    // The radical sign hangs from its reference point: ~0.04em above and, for
    // the text-size CMSY glyph, ~0.96em below. The CMEX variants used over
    // taller radicands go much deeper; the exact depth isn't recoverable, so
    // allow generously — the vinculum bounds the radicand from above anyway.
    top = g.y + 0.04 * g.size;
    bottom = g.y - (g.font === "cmex" ? 3 : 0.96) * g.size;
  } else if (g.font === "cmex") {
    // CMEX delimiters/operators are referenced near their top and extend downwards.
    top = g.y + 0.04 * g.size;
    bottom = g.y - 1.16 * g.size;
  } else {
    const tall = TALL_CHARS.test(text) || g.font === "text";
    top = g.y + (tall ? CM_ASCENT : CM_XHEIGHT) * g.size;
    bottom = g.y - (DESCENDER_CHARS.test(text) ? CM_DESCENT : 0) * g.size;
  }
  return { kind: "glyph", g, x1: g.x, x2: g.endX, top, bottom, baseline: g.y, size: g.size, claimed: false };
}

const centerX = (it: Item) => (it.x1 + it.x2) / 2;
const inSpan = (it: Item, x1: number, x2: number, tol = 0.6) => centerX(it) >= x1 - tol && centerX(it) <= x2 + tol;

// A glyph that sits right beside another glyph on the same baseline *outside*
// the span is part of a text line passing under/over the bar, not a
// numerator/denominator: TeX pads the bar past its contents on both sides.
function continuesOutside(it: Item, pool: Item[], x1: number, x2: number): boolean {
  const tol = it.kind === "glyph" ? 1 : 3; // a node's baseline is an estimate
  for (const o of pool) {
    if (o === it || o.claimed || o.kind !== "glyph") continue;
    // Only body-size text can be a line passing by; a small "+" beside a
    // small fraction is part of the same numerator or denominator.
    if (o.size < 9) continue;
    if (Math.abs(o.baseline - it.baseline) > tol) continue;
    if (inSpan(o, x1, x2)) continue;
    const gap = o.x1 >= it.x2 ? o.x1 - it.x2 : it.x1 - o.x2;
    // A fraction sits a thin space plus its bar padding from its neighbours.
    if (gap < (it.kind === "glyph" ? 1.2 : 4.5)) return true;
  }
  return false;
}

/**
 * Grows a numerator/denominator/radicand with the small raised or lowered
 * glyphs (exponents, degree signs, subscripts) hanging off its members. They
 * sit outside the tight window around the bar, so the window alone misses
 * them; adjacency to a member is what makes them safe to take.
 */
function extendWithScripts(members: Item[], pool: Item[], x1: number, x2: number): Item[] {
  const out = [...members];
  let grew = true;
  while (grew) {
    grew = false;
    for (const cand of pool) {
      if (cand.claimed || out.includes(cand) || cand.kind !== "glyph" || cand.size >= 9) continue;
      if (!inSpan(cand, x1, x2, 1.5)) continue;
      const attached = out.some(
        (m) =>
          cand.size < m.size * 0.95 &&
          cand.x1 - m.x2 > -1.5 &&
          cand.x1 - m.x2 < 2.5 &&
          cand.baseline - m.baseline > -4.5 &&
          cand.baseline - m.baseline < 6
      );
      if (attached) {
        out.push(cand);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Adds the in-span items sharing a baseline with what's already been taken:
 * a "+" between two small fractions in a denominator sits lower than the
 * bar window reaches, but on exactly their baseline.
 */
function extendByBaseline(members: Item[], pool: Item[], x1: number, x2: number): Item[] {
  const out = [...members];
  let grew = true;
  while (grew) {
    grew = false;
    for (const cand of pool) {
      if (cand.claimed || out.includes(cand) || !inSpan(cand, x1, x2)) continue;
      if (cand.kind === "glyph" && cand.g.font === "cmex") continue;
      const tol = cand.kind === "glyph" ? 1.5 : 3;
      if (out.some((m) => Math.abs(m.baseline - cand.baseline) <= tol)) {
        out.push(cand);
        grew = true;
      }
    }
  }
  return out;
}

function boxOf(items: Item[]): { x1: number; x2: number; top: number; bottom: number } {
  return {
    x1: Math.min(...items.map((i) => i.x1)),
    x2: Math.max(...items.map((i) => i.x2)),
    top: Math.max(...items.map((i) => i.top)),
    bottom: Math.min(...items.map((i) => i.bottom)),
  };
}

/**
 * The baseline shared by the largest items in a sequence — its "main line".
 * CMEX delimiters hang from a point well above the baseline, so they never
 * define it; among the rest, the most common baseline at the largest size wins.
 */
function dominantBaseline(items: Item[]): { baseline: number; size: number } {
  const regular = items.filter((it) => !(it.kind === "glyph" && it.g.font === "cmex"));
  const pool = regular.length ? regular : items;
  const maxSize = Math.max(...pool.map((i) => i.size));
  const big = pool.filter((i) => i.size >= maxSize - 0.3);
  let best = big[0];
  let bestCount = -1;
  for (const cand of big) {
    const count = big.filter((o) => Math.abs(o.baseline - cand.baseline) <= 1).length;
    if (count > bestCount) [best, bestCount] = [cand, count];
  }
  return { baseline: best.baseline, size: maxSize };
}

const BIG_OPERATORS = new Set(["∑", "∏", "∫", "∐", "⋃", "⋂"]);

/**
 * Consumes the rules in width order, turning each into a fraction or root
 * node that replaces the glyphs it claims. Returns the surviving top-level
 * items (glyphs plus nodes), unsorted.
 */
function assemble(glyphs: Glyph[], rules: Rule[]): Item[] {
  let items: Item[] = glyphs.map(glyphItem);
  const sortedRules = [...rules].sort((a, b) => a.x2 - a.x1 - (b.x2 - b.x1));

  for (const rule of sortedRules) {
    const width = rule.x2 - rule.x1;
    if (width < 1.5) continue;
    const pool = items.filter((it) => !it.claimed);
    const under = pool.filter((it) => inSpan(it, rule.x1, rule.x2));

    // Root: a "√" whose right edge meets the rule's left end at the rule's height.
    const radical = pool.find(
      (it) =>
        it.kind === "glyph" &&
        it.g.str === "√" &&
        Math.abs(it.x2 - rule.x1) <= 1.8 &&
        Math.abs(it.g.y - rule.y) <= 2.5
    );
    if (radical) {
      let radicand = under.filter(
        (it) => it !== radical && it.top <= rule.y + 0.6 && rule.y - it.top <= 9 && it.bottom >= radical.bottom - 1.5
      );
      if (process.env.TEXMATH_DEBUG) {
        const show = (arr: Item[]) => arr.map((i) => (i.kind === "glyph" ? i.g.str : i.kind) + `@${i.x1.toFixed(1)}`).join(" ");
        console.error(`root ${rule.x1.toFixed(1)}-${rule.x2.toFixed(1)} y${rule.y.toFixed(1)} radical@${radical.x1.toFixed(1)} under: ${show(under)} | radicand: ${show(radicand)}`);
      }
      if (radicand.length === 0) continue;
      radicand = extendByBaseline(radicand, pool, rule.x1, rule.x2);
      radicand = extendWithScripts(radicand, pool, rule.x1, rule.x2);
      if (process.env.TEXMATH_DEBUG) console.error(`  -> radicand: ${radicand.map((i) => (i.kind === "glyph" ? i.g.str : i.kind) + `@${i.x1.toFixed(1)}`).join(" ")}`);
      for (const it of radicand) it.claimed = true;
      radical.claimed = true;
      const box = boxOf(radicand);
      const dom = dominantBaseline(radicand);
      const node: SqrtItem = {
        kind: "sqrt",
        radicand,
        x1: radical.x1,
        x2: Math.max(rule.x2, box.x2),
        top: rule.y + 0.5,
        bottom: Math.min(box.bottom, radical.bottom),
        baseline: dom.baseline,
        size: dom.size,
        claimed: false,
      };
      items.push(node);
      continue;
    }

    // Fraction: contents hug the bar from both sides. A bare radical sign is
    // never a numerator or denominator by itself — it belongs to whichever
    // vinculum claims it (its depth is only estimated, so it can look close).
    const isRadicalSign = (it: Item) => it.kind === "glyph" && it.g.str === "√";
    let num = under.filter(
      (it) =>
        !isRadicalSign(it) &&
        it.bottom >= rule.y - 0.6 &&
        it.bottom - rule.y <= 4.5 &&
        !continuesOutside(it, pool, rule.x1, rule.x2)
    );
    let den = under.filter(
      (it) =>
        !isRadicalSign(it) &&
        it.top <= rule.y + 0.6 &&
        rule.y - it.top <= 4.5 &&
        !continuesOutside(it, pool, rule.x1, rule.x2)
    );
    if (process.env.TEXMATH_DEBUG) {
      const show = (arr: Item[]) => arr.map((i) => (i.kind === "glyph" ? i.g.str : i.kind) + `@${i.x1.toFixed(1)}[${i.top.toFixed(1)},${i.bottom.toFixed(1)}]`).join(" ");
      console.error(`rule ${rule.x1.toFixed(1)}-${rule.x2.toFixed(1)} y${rule.y.toFixed(1)} under: ${show(under)} | num: ${show(num)} | den: ${show(den)}`);
    }
    if (num.length === 0 || den.length === 0) continue;
    num = extendWithScripts(extendByBaseline(num, pool, rule.x1, rule.x2), pool, rule.x1, rule.x2);
    den = extendWithScripts(extendByBaseline(den, pool, rule.x1, rule.x2), pool, rule.x1, rule.x2);
    if (process.env.TEXMATH_DEBUG) console.error(`  -> num: ${num.map((i) => (i.kind === "glyph" ? i.g.str : i.kind) + `@${i.x1.toFixed(1)}`).join(" ")} | den: ${den.map((i) => (i.kind === "glyph" ? i.g.str : i.kind) + `@${i.x1.toFixed(1)}`).join(" ")}`);
    for (const it of num) it.claimed = true;
    for (const it of den) it.claimed = true;
    const nb = boxOf(num);
    const db = boxOf(den);
    const size = Math.max(...num.map((i) => i.size), ...den.map((i) => i.size));
    const node: FracItem = {
      kind: "frac",
      num,
      den,
      x1: Math.min(rule.x1, nb.x1, db.x1),
      x2: Math.max(rule.x2, nb.x2, db.x2),
      top: nb.top,
      bottom: db.bottom,
      // Bars sit on the maths axis of the surrounding line. Script-size
      // contents mean a text-size line around them.
      baseline: rule.y - AXIS * (size < 9 ? size * 10 / 7 : size),
      size,
      claimed: false,
    };
    items.push(node);
  }

  // Big operators (Σ etc.) with limits typeset above and below them.
  for (const it of items) {
    if (it.claimed || it.kind !== "glyph" || !BIG_OPERATORS.has(it.g.str)) continue;
    const small = items.filter(
      (o) =>
        o !== it &&
        !o.claimed &&
        o.size < it.size * 0.85 &&
        inSpan(o, it.x1, it.x2, 1.5) &&
        !continuesOutside(o, items, it.x1 - 1.5, it.x2 + 1.5)
    );
    // Limits sit right against the operator; anything further is another line.
    const upper = small.filter((o) => o.bottom >= it.top - 1 && o.bottom - it.top <= 4);
    const lower = small.filter((o) => o.top <= it.bottom + 1 && it.bottom - o.top <= 4);
    if (upper.length === 0 && lower.length === 0) continue;
    for (const o of [...upper, ...lower]) o.claimed = true;
    it.claimed = true;
    const all = [it, ...upper, ...lower];
    const box = boxOf(all);
    items.push({
      kind: "bigop",
      g: it.g,
      upper,
      lower,
      ...box,
      baseline: it.baseline,
      size: it.size,
      claimed: false,
    });
  }

  // Accents (\overrightarrow, \vec, \hat, \bar …) are drawn as their own
  // glyphs a few points above the letter they decorate. Left alone they form
  // a bogus text line of their own ("− →") between two real lines, which the
  // parser would then glue onto whichever option or sentence came before.
  for (const it of items) {
    if (it.claimed || it.kind !== "glyph" || it.g.font === "text") continue;
    const cmd = ACCENTS[it.g.str];
    if (!cmd) continue;
    // \overrightarrow{AB} is an arrowhead preceded by "−" pieces at the same
    // height; they extend the arrow's span and are not content.
    const pieces: Item[] = [it];
    if (it.g.str === "→") {
      for (const o of items) {
        if (o.claimed || o === it || o.kind !== "glyph" || o.g.str !== "−" || o.g.font !== "cmsy") continue;
        if (Math.abs(o.baseline - it.baseline) <= 0.5 && o.x1 <= it.x2 + 0.5 && o.x2 >= it.x1 - 12) pieces.push(o);
      }
    }
    const span = boxOf(pieces);
    const mid = (span.x1 + span.x2) / 2;
    // The decorated glyphs sit under the accent — either inside its span or,
    // for a zero-width combining glyph such as "⃗", around its position —
    // and on a baseline a fraction of an em below it: the accent is placed
    // just above the x-height, never a whole line up.
    let base = items.filter(
      (o) =>
        !o.claimed &&
        !pieces.includes(o) &&
        !(o.kind === "glyph" && o.g.font === "text") &&
        (inSpan(o, span.x1, span.x2, 1) || (mid >= o.x1 - 1 && mid <= o.x2 + 1)) &&
        it.baseline - o.baseline >= it.size * 0.15 &&
        it.baseline - o.baseline <= it.size * 0.8
    );
    // pdf.js reports a zero-width combining mark ("⃗" over an italic letter)
    // on the letter's own baseline, at the letter's edge. Attach it to the
    // letter it overlaps.
    if (base.length === 0 && span.x2 - span.x1 < 0.5) {
      base = items.filter(
        (o) =>
          !o.claimed &&
          o !== it &&
          o.kind === "glyph" &&
          o.g.font !== "text" &&
          /^[A-Za-zα-ωΑ-Ω]$/.test(o.g.str) &&
          Math.abs(o.baseline - it.baseline) < 0.5 &&
          mid >= o.x1 - 0.5 &&
          mid <= o.x2 + 0.5
      );
    }
    if (base.length === 0) continue;
    for (const o of [...pieces, ...base]) o.claimed = true;
    const box = boxOf([...pieces, ...base]);
    const dom = dominantBaseline(base);
    items.push({ kind: "accent", cmd, base, ...box, baseline: dom.baseline, size: dom.size, claimed: false });
  }

  items = items.filter((it) => !it.claimed);
  return items;
}

// Glyphs TeX places above a letter as an accent, keyed to the command that
// puts them back. "→" only counts when it is raised above something.
const ACCENTS: Record<string, string> = {
  "→": "\\overrightarrow", "⃗": "\\vec", "^": "\\hat", "ˆ": "\\hat", "¯": "\\bar", "ˉ": "\\bar",
  "˙": "\\dot", "~": "\\tilde", "˜": "\\tilde", "¨": "\\ddot",
};

// ---------------------------------------------------------------------------
// Emission: items → LaTeX.

const GREEK: Record<string, string> = {
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\varepsilon", "ϵ": "\\epsilon", "ζ": "\\zeta",
  "η": "\\eta", "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu", "ν": "\\nu",
  "ξ": "\\xi", "π": "\\pi", "ρ": "\\rho", "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\varphi",
  "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega", "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda",
  "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega", "ℓ": "\\ell", "∂": "\\partial",
};

const SYMBOLS: Record<string, string> = {
  "−": "-", "–": "-", "·": "\\cdot", "×": "\\times", "÷": "\\div", "±": "\\pm", "∓": "\\mp",
  "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "∝": "\\propto",
  "∞": "\\infty", "→": "\\to", "←": "\\leftarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow",
  "↔": "\\leftrightarrow", "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "⊆": "\\subseteq", "∪": "\\cup", "∩": "\\cap",
  "∴": "\\therefore", "∵": "\\because", "∀": "\\forall", "∃": "\\exists", "∅": "\\varnothing", "◦": "\\circ",
  "∘": "\\circ", "•": "\\bullet", "′": "'", "″": "''", "′′": "''", "…": "\\ldots", "⋯": "\\cdots", "√": "\\surd",
  "∠": "\\angle", "⊥": "\\perp", "∥": "\\parallel", "∗": "*", "°": "^{\\circ}", "∑": "\\sum", "∏": "\\prod",
  "∫": "\\int", "ℜ": "\\Re", "ℑ": "\\Im", "ℏ": "\\hbar", "∇": "\\nabla", "⟨": "\\langle", "⟩": "\\rangle",
  "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "#": "\\#", "$": "\\$", "_": "\\_", "^": "\\^{}", "~": "\\sim",
  "\\": "\\backslash", "̸": "\\not", "∣": "|", "∤": "\\nmid",
};

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "cosec", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth",
  "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "gcd", "deg", "arg", "hom", "ker",
]);

const BIG_DELIMS: Record<string, string> = {
  "(": "\\bigl(", ")": "\\bigr)", "[": "\\bigl[", "]": "\\bigr]", "{": "\\bigl\\{", "}": "\\bigr\\}",
  "|": "\\big|", "∣": "\\big|", "‖": "\\big\\|", "⟨": "\\bigl\\langle", "⟩": "\\bigr\\rangle", "/": "\\big/",
};

function mathToken(g: Glyph): string {
  const s = g.str;
  if (g.font === "cmex") {
    if (BIG_DELIMS[s]) return BIG_DELIMS[s];
    if (SYMBOLS[s]) return SYMBOLS[s];
  }
  if (FUNCTIONS.has(s.toLowerCase())) return `\\${s.toLowerCase() === "cosec" ? "operatorname{cosec}" : s.toLowerCase()}`;
  let out = "";
  for (const ch of Array.from(s)) {
    if (GREEK[ch]) out += GREEK[ch] + " ";
    else if (SYMBOLS[ch]) out += SYMBOLS[ch] + " ";
    else out += ch;
  }
  return out.trim();
}

function isMathGlyph(g: Glyph): boolean {
  if (g.font !== "text") return true;
  if (FUNCTIONS.has(g.str.toLowerCase())) return true;
  // An operator set in the text font (the "=" of a \Longrightarrow, a stray
  // "+") belongs with the maths around it.
  return /^[=+\-−<>×·]+$/.test(g.str);
}

/**
 * Emits a horizontal sequence of items as LaTeX (maths mode). Small glyphs
 * whose baseline is raised/lowered relative to the sequence's main baseline
 * become superscripts/subscripts attached to the item before them.
 */
function emitMath(items: Item[], nested: boolean): string {
  const sorted = [...items].sort((a, b) => a.x1 - b.x1);
  const { baseline, size } = dominantBaseline(sorted);
  const role = (it: Item): "sup" | "sub" | "base" => {
    if (it.kind !== "glyph" || it.g.font === "cmex") return "base";
    if (it.size > size * 1.05) return "base";
    // Scripts are usually smaller, but at the smallest maths size (5pt) TeX
    // can't shrink further, so a same-size glyph clearly off the baseline
    // counts too.
    const shift = it.baseline - baseline;
    const smaller = it.size < size * 0.92;
    if (shift > (smaller ? 1.2 : 1.8)) return "sup";
    if (-shift > (smaller ? 1.2 : 1.8)) return "sub";
    return "base";
  };

  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const it = sorted[i];
    const r = role(it);
    if (r === "base") {
      // A tall delimiter is drawn as several CMEX pieces stacked at one x;
      // one \big| stands for all of them.
      const prev = sorted[i - 1];
      const duplicatePiece =
        prev !== undefined &&
        it.kind === "glyph" &&
        prev.kind === "glyph" &&
        it.g.font === "cmex" &&
        prev.g.font === "cmex" &&
        it.g.str === prev.g.str &&
        Math.abs(it.x1 - prev.x1) < 1.5;
      if (!duplicatePiece) out.push(emitItem(it, nested));
      i++;
      continue;
    }
    // Gather the run of same-role script glyphs and emit them as one script.
    const run: Item[] = [];
    while (i < sorted.length && role(sorted[i]) === r) run.push(sorted[i++]);
    const script = emitMath(run, true);
    const wrapped = `${r === "sup" ? "^" : "_"}{${script}}`;
    if (out.length === 0) out.push("{}" + wrapped);
    else out[out.length - 1] += wrapped;
  }
  return tidyMath(out.join(" "));
}

/** Cosmetic clean-up of an emitted maths string. */
function tidyMath(tex: string): string {
  return tex
    .replace(/\\not\s*=/g, "\\ne")
    // pdf.js sometimes glues an accent onto the run before it ("= 30ˆ"), so
    // it reaches here on the baseline with no geometry to attach it by; the
    // letter after it is the one it decorates.
    .replace(/ˆ\s*([A-Za-z])/g, "\\hat{$1}")
    .replace(/⃗\s*([A-Za-z])/g, "\\vec{$1}")
    .replace(/([A-Za-z])\s*\^\{⃗\}/g, "\\vec{$1}")
    .replace(/([A-Za-z])\s*\^\{ˆ\}/g, "\\hat{$1}")
    .replace(/(?:\\cdot\s*){3,}/g, "\\cdots ")
    .replace(/(?:\.\s*){3,}/g, "\\ldots ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .replace(/(\d) (?=\d)/g, "$1")
    .replace(/(\d) \. (?=\d)/g, "$1.")
    .replace(/= \\Rightarrow/g, "\\Longrightarrow")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function emitItem(it: Item, nested: boolean): string {
  switch (it.kind) {
    case "glyph":
      return mathToken(it.g);
    case "frac":
      return `${nested ? "\\frac" : "\\dfrac"}{${emitMath(it.num, true)}}{${emitMath(it.den, true)}}`;
    case "sqrt":
      return `\\sqrt{${emitMath(it.radicand, true)}}`;
    case "bigop": {
      const op = SYMBOLS[it.g.str] ?? it.g.str;
      const lo = it.lower.length ? `_{${emitMath(it.lower, true)}}` : "";
      const hi = it.upper.length ? `^{${emitMath(it.upper, true)}}` : "";
      return `${op}${lo}${hi}`;
    }
    case "accent":
      return `${it.cmd}{${emitMath(it.base, true)}}`;
  }
}

const isMathItem = (it: Item) => it.kind !== "glyph" || isMathGlyph(it.g);
const MATH_RUN_GAP_EM = 2.2;

/**
 * Turns one line's items into prose with embedded \( … \) maths runs.
 * Adjacent maths items form a single run; prose words separate runs, and so
 * does a wide horizontal gap: options are laid out in a grid, so a row of
 * two wrapped option tails ("q, D → p)      q, D → p)") or of two stacked
 * numerators ("18      8") is two fragments the parser places by column, not
 * one formula. TeX never leaves more than a \qquad (2em) inside a formula.
 */
function emitLine(items: Item[]): { text: string; fragments: { text: string; x: number; endX: number }[] } {
  const sorted = [...items].sort((a, b) => a.x1 - b.x1);
  const fragments: { text: string; x: number; endX: number }[] = [];
  let text = "";
  let prevEnd = -Infinity;
  const push = (piece: string, x1: number, x2: number) => {
    // Prose runs that abut (a word and its trailing comma) stay joined; a
    // real gap gets a space. Maths runs always get one.
    const joined = text && (piece.startsWith("\\(") || x1 - prevEnd > 0.8);
    text += (joined ? " " : "") + piece;
    prevEnd = x2;
    fragments.push({ text: piece, x: x1, endX: x2 });
  };
  let i = 0;
  while (i < sorted.length) {
    const it = sorted[i];
    if (!isMathItem(it)) {
      push((it as GlyphItem).g.str, it.x1, it.x2);
      i++;
      continue;
    }
    const run: Item[] = [];
    while (i < sorted.length && isMathItem(sorted[i])) {
      const prev = run[run.length - 1];
      if (prev && sorted[i].x1 - prev.x2 > MATH_RUN_GAP_EM * Math.max(prev.size, sorted[i].size)) break;
      run.push(sorted[i++]);
    }
    const last = run[run.length - 1];
    push(`\\(${emitMath(run, false)}\\)`, run[0].x1, last.x2);
  }
  return { text: text.replace(/\s+/g, " ").trim(), fragments };
}

// ---------------------------------------------------------------------------
// Lines.

/**
 * Groups the surviving items into text lines. Items at the page's main text
 * size anchor the lines; small glyphs (scripts, degree signs) and CMEX
 * glyphs (which hang from above the baseline) attach to the nearest anchor.
 */
/** The most common size among prose glyphs — the body text size. */
function mainTextSize(glyphs: Glyph[]): number {
  const sizes = new Map<number, number>();
  for (const g of glyphs) {
    if (g.font !== "text") continue;
    const k = Math.round(g.size * 10) / 10;
    sizes.set(k, (sizes.get(k) ?? 0) + 1);
  }
  let mainSize = 0;
  let mainCount = -1;
  for (const [k, c] of sizes) if (c > mainCount) [mainSize, mainCount] = [k, c];
  return mainSize;
}

function groupLines(items: Item[]): { y: number; items: Item[] }[] {
  if (items.length === 0) return [];
  let mainSize = mainTextSize(items.filter((i): i is GlyphItem => i.kind === "glyph").map((i) => i.g));
  if (mainSize === 0) mainSize = Math.max(...items.map((i) => i.size));

  const isAnchor = (it: Item) =>
    it.kind !== "glyph" ? true : it.g.font !== "cmex" && it.size >= mainSize * 0.9;

  const lines: { y: number; items: Item[] }[] = [];
  const anchors = items.filter(isAnchor).sort((a, b) => b.baseline - a.baseline);
  for (const it of anchors) {
    const last = lines[lines.length - 1];
    const tol = it.kind === "glyph" ? 1.5 : 3.5;
    if (last && Math.abs(last.y - it.baseline) <= tol) last.items.push(it);
    else lines.push({ y: it.baseline, items: [it] });
  }
  // Re-centre each line on its glyph baselines (nodes only estimate theirs).
  for (const line of lines) {
    const gl = line.items.filter((i) => i.kind === "glyph");
    if (gl.length) line.y = gl[0].baseline;
  }

  for (const it of items) {
    if (isAnchor(it)) continue;
    let best: { y: number; items: Item[] } | null = null;
    let bestD = Infinity;
    for (const line of lines) {
      const d = it.baseline - line.y; // positive = above the line
      const ok = it.kind === "glyph" && it.g.font === "cmex" ? d >= -3 && d <= 22 : d >= -6 && d <= 12;
      if (!ok) continue;
      const dist = Math.abs(d);
      if (dist < bestD) {
        bestD = dist;
        best = line;
      }
    }
    if (best) best.items.push(it);
    else lines.push({ y: it.baseline, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/**
 * The whole pipeline for one column of one page: glyphs + rules in, lines of
 * prose-with-LaTeX out (top to bottom).
 */
export function layoutTexColumn(glyphs: Glyph[], rules: Rule[]): LineOut[] {
  // Watermarks ("Institute Name" at 30pt across the page) would otherwise
  // become a line that stray superscripts attach to.
  const main = mainTextSize(glyphs);
  const kept = main ? glyphs.filter((g) => g.size <= main * 2.2) : glyphs;
  const items = assemble(kept, rules);
  return groupLines(items)
    .map((line) => ({ y: line.y, ...emitLine(line.items) }))
    .filter((l) => l.text);
}

/** Recognises the Computer Modern family from a PDF font's base name. */
export function classifyFont(name: string | undefined): FontClass {
  const n = (name ?? "").toUpperCase();
  if (/CMEX/.test(n)) return "cmex";
  if (/CMSY|MSAM|MSBM/.test(n)) return "cmsy";
  if (/CMMI/.test(n)) return "cmmi";
  if (/CMR|CMBX|CMSS|CMTT/.test(n)) return "cmr";
  return "text";
}
