// Reconstructs fractions, roots, and exponents that pdf.js flattens into
// disconnected, vertically-stacked rows of text — numerator above a fraction
// bar above denominator; a radical sign above/beside its radicand; a raised
// exponent above its base — into single inline tokens carrying enough
// structure for MathText to render them as proper stacked notation.
//
// Real paragraph lines in these generated exam PDFs sit ~12pt apart (measured
// directly from sample PDFs); the rows making up a fraction or exponent sit
// only ~3-4.5pt apart. That gap is tight enough to reliably tell "this is
// part of a stacked math element" from "this is simply the next line of
// prose" — the same signal already used for vector arrows and degree signs
// in pdfMarks.ts, just applied to whole rows instead of single glyphs.
//
// Emits marker text consumed by shared/mathText.ts:
//   fraction: "⟦num⁄den⟧"      root: "⟦√radicand⟧"      exponent: "base^(exp)"
// (the exponent form reuses the caret syntax MathText already understood.)

export interface StackItem {
  str: string;
  x: number;
  y: number;
  endX: number;
}

// pt: observed stack gaps range ~2.5-9.2 (a root sign needs more clearance
// above its radicand than a plain exponent does), while prose line-height in
// these papers is consistently ~12+ — 10 keeps a safety margin below that
// while catching the widest real stack gaps seen so far.
const TIGHT_GAP = 10;
const CELL_GAP = 9; // pt: horizontal gap within a row that separates distinct terms

const FRAC_OPEN = "⟦";
const FRAC_SEP = "⁄";
const FRAC_CLOSE = "⟧";
export const ROOT_TAG = "√";

interface Row {
  y: number;
  cells: Cell[];
}

interface Cell {
  text: string;
  x: number;
  endX: number;
  items: StackItem[];
}

function groupRows(items: StackItem[]): Row[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const raw: { y: number; items: StackItem[] }[] = [];
  const TOL = 2.5;
  for (const it of sorted) {
    const last = raw[raw.length - 1];
    if (last && Math.abs(last.y - it.y) <= TOL) last.items.push(it);
    else raw.push({ y: it.y, items: [it] });
  }
  return raw.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    return { y: r.y, cells: splitIntoCells(r.items) };
  });
}

// "(A)" / "(B)" / "(C)" / "(D)" option-letter labels sit close enough to the
// start of their answer content (observed as little as ~5pt) to fall inside
// the normal within-term gap tolerance, which would otherwise fuse the label
// onto the first cell of the answer's math content. Force a boundary around
// them unconditionally so a label never becomes part of a merged fraction.
const OPTION_LABEL_RE = /^\([A-Da-d]\)$/;

function splitIntoCells(items: StackItem[]): Cell[] {
  const cells: Cell[] = [];
  let cur: StackItem[] = [];
  const flush = () => {
    if (cur.length) cells.push(makeCell(cur));
    cur = [];
  };
  for (const it of items) {
    const prev = cur[cur.length - 1];
    const isLabel = OPTION_LABEL_RE.test(it.str.trim());
    const prevWasLabel = prev !== undefined && OPTION_LABEL_RE.test(prev.str.trim());
    if (prev && (isLabel || prevWasLabel || it.x - prev.endX > CELL_GAP)) flush();
    cur.push(it);
  }
  flush();
  return cells;
}

function makeCell(items: StackItem[]): Cell {
  return {
    text: items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
    x: items[0].x,
    endX: items[items.length - 1].endX,
    items,
  };
}

function overlap(a: Cell, b: Cell): number {
  return Math.max(0, Math.min(a.endX, b.endX) - Math.max(a.x, b.x));
}

/** A cell that's essentially symbols/digits/short math — not real prose. */
function isMathy(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (!compact) return false;
  if (OPTION_LABEL_RE.test(compact)) return false; // "(C)" is short but not math content
  // A bare root sign is not a complete term — it's only ever valid content
  // for the dedicated root-merge branch (which supplies its radicand),
  // never as a fraction's numerator/denominator or an exponent's base.
  if (compact === ROOT_TAG) return false;
  if (compact.length <= 3) return true;
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  return letters / compact.length <= 0.6;
}

// A circuit breaker against runaway merges. A genuine numerator, denominator,
// radicand, or exponent in these papers is a short term — a few symbols, at
// most a couple of characters/words. Without this, a wrong cell-match (wrong
// column, misdetected row pairing) can swallow an entire neighboring
// question's prose into a fraction marker, and — since merged markers can
// themselves become inputs to a later pass — compound across iterations into
// deeply nested garbage. Anything longer than a genuine term would ever be,
// or that's already been wrapped more than once, is refused outright.
function isSafeToMerge(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (compact.length === 0 || compact.length > 14) return false;
  if (text.trim().split(/\s+/).length > 2) return false;
  const nestDepth = (text.match(/⟦/g) ?? []).length;
  return nestDepth < 2;
}

// Real exponents in these papers are a single raised digit (², ³, ⁴); keeping
// this narrow avoids the ambiguity a multi-digit run would have against a
// short numerator (see the overlap-ratio check below, which is what actually
// tells the two apart).
const EXPONENT_TEXT_RE = /^[0-9]$/;

function markerCell(text: string, x: number, endX: number, y: number): Cell {
  const item: StackItem = { str: text, x, y, endX };
  return { text, x, endX, items: [item] };
}

/**
 * Tries to fold `top` (the row above) into `base` (the row below), cell by
 * cell. Returns the revised base-row cells and whatever top-row cells were
 * left unmerged (kept as their own row), or null if nothing in this pair
 * looked like a stacked math element.
 */
function tryMergeRows(top: Row, base: Row): { baseCells: Cell[]; topLeftover: Cell[] } | null {
  const baseCells = [...base.cells];
  const claimedBase = new Set<number>();
  const topLeftover: Cell[] = [];
  let mergedAny = false;

  for (const topCell of top.cells) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    baseCells.forEach((baseCell, idx) => {
      if (claimedBase.has(idx)) return;
      const ov = overlap(topCell, baseCell);
      const centerDist = Math.abs((topCell.x + topCell.endX) / 2 - (baseCell.x + baseCell.endX) / 2);
      // A lone root sign has ~zero width and sits at its radicand's left
      // edge rather than centered over it, so score it on proximity alone.
      const score = topCell.text === ROOT_TAG ? -Math.abs(topCell.x - baseCell.x) : ov - centerDist * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    const baseCell = bestIdx === -1 ? null : baseCells[bestIdx];
    if (!baseCell) {
      topLeftover.push(topCell);
      continue;
    }

    if (topCell.text === ROOT_TAG && Math.abs(topCell.x - baseCell.x) < 20 && isSafeToMerge(baseCell.text)) {
      baseCells[bestIdx] = markerCell(
        `${FRAC_OPEN}${ROOT_TAG}${baseCell.text}${FRAC_CLOSE}`,
        baseCell.x,
        baseCell.endX,
        base.y
      );
      claimedBase.add(bestIdx);
      mergedAny = true;
      continue;
    }

    const ov = overlap(topCell, baseCell);
    const topWidth = Math.max(1, topCell.endX - topCell.x);
    const overlapRatio = ov / topWidth;
    // "Near end" means genuinely adjacent to the base's right edge — not
    // just the least-bad of several unrelated candidates on the row (the
    // nearest-candidate search above always returns *something*, even when
    // nothing is actually close).
    const isNearEnd = topCell.x >= baseCell.endX - 4 && topCell.x <= baseCell.endX + 8;

    // A numerator sits mostly *over* its (comparatively narrow) denominator —
    // high overlap relative to its own width. An exponent sits mostly
    // *past* the end of its base, barely overlapping it at all. Checking
    // overlap ratio first is what tells "1" over "√3" (a fraction) apart
    // from "3" past the end of "R" (an exponent) — near-end position alone
    // isn't enough, since a narrow numerator can coincidentally register as
    // "near the end" of a narrow denominator too.
    if (
      overlapRatio > 0.45 &&
      isMathy(topCell.text) &&
      isMathy(baseCell.text) &&
      isSafeToMerge(topCell.text) &&
      isSafeToMerge(baseCell.text)
    ) {
      baseCells[bestIdx] = markerCell(
        `${FRAC_OPEN}${topCell.text}${FRAC_SEP}${baseCell.text}${FRAC_CLOSE}`,
        baseCell.x,
        baseCell.endX,
        base.y
      );
      claimedBase.add(bestIdx);
      mergedAny = true;
      continue;
    }

    if (
      overlapRatio < 0.35 &&
      isNearEnd &&
      EXPONENT_TEXT_RE.test(topCell.text) &&
      isMathy(baseCell.text) &&
      isSafeToMerge(baseCell.text)
    ) {
      baseCells[bestIdx] = markerCell(`${baseCell.text}^(${topCell.text})`, baseCell.x, baseCell.endX, base.y);
      claimedBase.add(bestIdx);
      mergedAny = true;
      continue;
    }

    // Doesn't look like a genuine stacked pairing (e.g. two ordinary prose
    // lines that happened to sit close) — leave both sides untouched.
    topLeftover.push(topCell);
  }

  if (!mergedAny) return null;
  return { baseCells, topLeftover };
}

// Walks bottom-to-top so the *innermost* stacked pair resolves first: e.g. a
// root sign has to fuse with its radicand one row down before a numerator
// one row up gets a chance to look at that cell — otherwise the numerator
// claims a still-bare "√" and the radicand is left stranded.
function onePass(rows: Row[]): { rows: Row[]; changed: boolean } {
  const out: Row[] = [];
  let changed = false;
  let i = rows.length - 1;
  while (i >= 0) {
    const base = rows[i];
    const top = i > 0 ? rows[i - 1] : undefined;
    if (top) {
      const gap = top.y - base.y;
      if (gap > 0 && gap <= TIGHT_GAP) {
        const result = tryMergeRows(top, base);
        if (result) {
          changed = true;
          out.unshift({ y: base.y, cells: result.baseCells });
          if (result.topLeftover.length > 0) out.unshift({ y: top.y, cells: result.topLeftover });
          i -= 2;
          continue;
        }
      }
    }
    out.unshift(base);
    i -= 1;
  }
  return { rows: out, changed };
}

/**
 * Folds stacked fraction/root/exponent rows onto their base row throughout a
 * single text column, returning a flat item list ready for the normal
 * line-grouping pass. Cells that were never touched keep their original,
 * per-glyph item breakdown (so downstream option-column matching by x still
 * works); merged cells become one synthetic item carrying marker text.
 */
export function reconstructStacks(items: StackItem[]): StackItem[] {
  let rows = groupRows(items);
  for (let iter = 0; iter < 5; iter++) {
    const { rows: next, changed } = onePass(rows);
    rows = next;
    if (!changed) break;
  }
  return rows.flatMap((r) => r.cells.flatMap((c) => c.items));
}
