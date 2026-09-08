// LaTeX-generated exam PDFs draw certain marks as their own small, separately
// positioned glyph rather than as part of the base text run:
//   - vector notation (P⃗) and unit-vector hats (î ĵ k̂): a combining accent
//     glyph centered a few points above a single base letter.
//   - degree symbols (60°): a small raised circle glyph — often the "white
//     bullet" ◦ rather than a real degree sign — placed just past the end of
//     the preceding number run, not centered over a single character.
// pdf.js reports each as its own text item, so naive line-grouping (which
// only tolerates ~2.5pt of vertical drift) frequently splits it onto its own
// row — it then sorts *before* the line it belongs to (higher y = higher on
// the page) and can drift arbitrarily far from its base by the time reading
// order is reassembled (observed landing appended to a *different*
// question's last option, having stolen degree marks from the question
// after it).
//
// Fix: before any line/column grouping runs, merge each such glyph onto the
// nearest base text run by horizontal proximity to that run's span — not just
// its start x, since a degree mark sits past a multi-character run's *end*
// while a letter accent sits centered over a single-character run's start —
// using a taller vertical window than normal line grouping allows.

// Marks that aren't already the character they should render as get remapped
// on merge. Combining accents (hat/acute/grave/tilde) need the real combining
// form; the degree glyph gets normalized to the actual Unicode degree sign so
// it renders consistently regardless of which substitute glyph the PDF used.
const ACCENT_REMAP: Record<number, string> = {
  0x02c6: "̂", // ˆ (hat, e.g. unit vectors î ĵ k̂) -> combining circumflex
  0x00b4: "́", // ´ (acute) -> combining acute
  0x0060: "̀", // ` (grave) -> combining grave
  0x02dc: "̃", // ˜ (small tilde) -> combining tilde
  0x25e6: "°", // ◦ (white bullet, used here as a degree-sign substitute)
};

const MARK_CODEPOINTS = new Set<number>([
  0x20d7, // combining right arrow above (vector notation)
  0x0302, 0x02c6, // circumflex / hat
  0x0303, 0x02dc, // tilde
  0x0301, 0x00b4, // acute
  0x0300, 0x0060, // grave
  0x0307, // dot above
  0x030a, // ring above
  0x25e6, // ◦ white bullet (degree-sign substitute)
  0x00b0, // ° degree sign (in case it too arrives as its own item)
]);

function markCodepoint(str: string): number | null {
  const chars = Array.from(str);
  if (chars.length !== 1) return null;
  const cp = chars[0].codePointAt(0);
  return cp !== undefined && MARK_CODEPOINTS.has(cp) ? cp : null;
}

// Degree signs (0x25e6 white bullet / 0x00b0) sit past the *end* of a
// possibly multi-character run ("(60" + degree mark right after the "0").
// Every other mark here is a letter accent (hat/arrow/tilde/etc), centered
// over a single base character instead. These need different distance
// metrics: an end-anchored one used naively on a wide base letter (like "E")
// can register zero distance for a mark that's actually centered over the
// *next*, narrower character (like "i" right after it) — its x can fall
// inside the wide letter's span well before reaching the narrow one's own
// center, so an edge/containment check alone isn't enough to tell them apart.
const END_ANCHORED_MARKS = new Set<number>([0x25e6, 0x00b0]);

/**
 * Horizontal distance from a mark to a base run's span [x, endX]. Zero while
 * the mark sits over the run; otherwise the gap to whichever edge is nearer —
 * this is what lets a degree mark find the *end* of a multi-character number
 * run like "(60" instead of its start.
 */
function endDist(markX: number, base: { x: number; endX?: number }): number {
  const start = base.x;
  const end = base.endX ?? base.x;
  if (markX < start) return start - markX;
  if (markX > end) return markX - end;
  return 0;
}

/** Distance from a mark to a base run's horizontal center — for an accent
 * that's meant to sit centered over one (typically single-character) base. */
function centerDist(markX: number, base: { x: number; endX?: number }): number {
  const end = base.endX ?? base.x;
  return Math.abs(markX - (base.x + end) / 2);
}

/**
 * Removes standalone mark-glyph text items from `items`, appending each one
 * onto the nearest base text run it visually sits above/after. Returns a new
 * array (bases only, marks folded in) in the same relative order as input.
 */
export function mergeCombiningMarks<T extends { str: string; x: number; y: number; endX?: number }>(
  items: T[]
): T[] {
  const marks: T[] = [];
  const bases: T[] = [];
  for (const it of items) {
    if (markCodepoint(it.str) !== null) marks.push(it);
    else bases.push(it);
  }
  if (marks.length === 0) return items;

  for (const mark of marks) {
    const cp = markCodepoint(mark.str)!;
    const endAnchored = END_ANCHORED_MARKS.has(cp);
    let best: T | null = null;
    let bestDist = Infinity;
    for (const base of bases) {
      const dy = mark.y - base.y; // marks sit above their base (larger y)
      if (dy < -1 || dy > 14) continue;
      const dx = endAnchored ? endDist(mark.x, base) : centerDist(mark.x, base);
      if (dx > 12) continue;
      const dist = dx + dy * 0.5;
      if (dist < bestDist) {
        bestDist = dist;
        best = base;
      }
    }
    if (best) {
      best.str += ACCENT_REMAP[cp] ?? mark.str;
    }
    // No base found within tolerance: drop the stray mark rather than
    // emitting a disconnected symbol on its own line.
  }
  return bases;
}
