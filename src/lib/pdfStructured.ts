// Structured extraction for multi-column exam PDFs that the strict single-column
// parser (pdfText.ts + questionParser.ts) can't handle: auto-detects a left/right
// column split per page, reads left-column-then-right-column top to bottom, and
// pulls out embedded diagram images in the same reading-order sequence so they can
// be attached to whichever question/explanation they appear next to.

export interface TextFragment {
  text: string;
  x: number;
}

export type PdfEvent =
  | { kind: "text"; value: string; fragments: TextFragment[]; y: number }
  | { kind: "image"; buffer: Buffer; width: number; height: number }
  | { kind: "pagebreak" };

interface TextItem {
  str: string;
  x: number;
  y: number;
  endX: number; // estimated right edge, used only for column-gap detection
}

interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  buffer: Buffer;
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, base: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = base;
  return [
    a * a2 + b * c2,
    a * b2 + b * d2,
    c * a2 + d * c2,
    c * b2 + d * d2,
    e * a2 + f * c2 + e2,
    e * b2 + f * d2 + f2,
  ];
}

function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

interface Span {
  y: number;
  minX: number;
  maxX: number;
}

// Text items sharing an exact baseline (same y) can't be told apart from two
// *different* columns whose rows happen to be grid-aligned to the same y —
// which is common in these generated exam PDFs. So instead of merging same-y
// items into one row outright, we first split them into finer "spans": a new
// span starts not just on a y change but whenever the horizontal gap to the
// previous item (estimated using its rendered width) is wide enough to plausibly
// be a column gutter rather than normal word spacing.
function groupSpans(items: TextItem[], maxGap: number): Span[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const Y_TOLERANCE = 2.5;
  const spans: Span[] = [];
  let cur: { y: number; minX: number; maxX: number } | null = null;
  for (const item of sorted) {
    if (cur && Math.abs(cur.y - item.y) <= Y_TOLERANCE && item.x - cur.maxX <= maxGap) {
      cur.maxX = Math.max(cur.maxX, item.endX);
    } else {
      if (cur) spans.push(cur);
      cur = { y: item.y, minX: item.x, maxX: item.endX };
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

// A real two-column layout has a narrow vertical gutter that almost no text
// span crosses, whereas continuous single-column prose straddles the page's
// midpoint constantly. So rather than looking for the single widest x-gap
// (too fragile — gutters can be as narrow as ~15pt), we pick the candidate
// split line within the central band that the fewest spans straddle.
function detectColumnBoundary(items: TextItem[], pageWidth: number): number | null {
  const spans = groupSpans(items, 8);
  if (spans.length < 4) return null;

  // A genuine two-column gutter sits near the middle of the page. Allowing
  // candidates far off-centre lets a sparse page (an answer-key grid, say)
  // produce a spurious "low crossing" split that scrambles its reading order.
  const bandLo = pageWidth * 0.4;
  const bandHi = pageWidth * 0.6;
  const candidateXs = Array.from(new Set(spans.flatMap((s) => [s.minX, s.maxX])))
    .filter((x) => x >= bandLo && x <= bandHi)
    .sort((a, b) => a - b);

  let bestSplit: number | null = null;
  let bestCrossing = Infinity;
  let bestCorridor = 0;
  const allCrossings: number[] = [];

  for (let i = 1; i < candidateXs.length; i++) {
    const split = (candidateXs[i - 1] + candidateXs[i]) / 2;
    let crossing = 0;
    // Width of the empty vertical strip this split sits in — i.e. the gutter.
    let leftEdge = -Infinity;
    let rightEdge = Infinity;
    for (const s of spans) {
      if (s.minX < split && s.maxX > split) crossing++;
      if (s.maxX <= split) leftEdge = Math.max(leftEdge, s.maxX);
      if (s.minX >= split) rightEdge = Math.min(rightEdge, s.minX);
    }
    const corridor = isFinite(leftEdge) && isFinite(rightEdge) ? rightEdge - leftEdge : 0;

    allCrossings.push(crossing);
    if (crossing < bestCrossing || (crossing === bestCrossing && corridor > bestCorridor)) {
      bestSplit = split;
      bestCrossing = crossing;
      bestCorridor = corridor;
    }
  }

  if (bestSplit === null) return null;

  // The gutter shows up as a sharp dip: almost nothing crosses it, while a
  // typical line through the page's middle is crossed constantly. Compare the
  // best candidate against the median rather than using an absolute gap width
  // (adjacent candidate x-values are often ~0 apart, where one span ends and
  // the next begins, so raw gap width is not a usable signal).
  const sortedCrossings = [...allCrossings].sort((a, b) => a - b);
  const median = sortedCrossings[Math.floor(sortedCrossings.length / 2)];
  if (median === 0) return null;
  const ratio = bestCrossing / median;

  // Sparse pages — answer-key grids, cover pages, a page holding the tail of
  // one question — are never worth splitting: there's little to reorder, and
  // their scattered cells can imitate a gutter. Requiring real text density
  // first is what keeps an answer key from being sliced down the middle.
  if (spans.length < 100) return null;

  // A pronounced dip is conclusive on its own. A weaker dip still means two
  // columns provided there's a genuinely wide empty corridor.
  if (ratio <= 0.25) return bestSplit;
  if (ratio <= 0.4 && bestCorridor >= 8) return bestSplit;
  return null;
}

function groupIntoLines(items: TextItem[]): { y: number; text: string; fragments: TextFragment[] }[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rowGroups: TextItem[][] = [];
  const Y_TOLERANCE = 2.5;
  for (const item of sorted) {
    const lastGroup = rowGroups[rowGroups.length - 1];
    if (lastGroup && Math.abs(lastGroup[0].y - item.y) <= Y_TOLERANCE) {
      lastGroup.push(item);
    } else {
      rowGroups.push([item]);
    }
  }
  return rowGroups
    .map((group) => {
      group.sort((a, b) => a.x - b.x);
      return {
        y: group[0].y,
        text: group.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
        // Kept so the parser can assign stacked fraction parts to the right
        // option by horizontal position rather than by line order.
        fragments: group.map((i) => ({ text: i.str, x: i.x })),
      };
    })
    .filter((l) => l.text);
}

export async function extractStructuredPdf(buffer: Buffer): Promise<PdfEvent[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const events: PdfEvent[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const textItems: TextItem[] = content.items
      .map((it) => {
        if (!("str" in it) || it.str.trim().length === 0) return null;
        const x = it.transform[4];
        const y = it.transform[5];
        // pdf.js reports each run's true rendered width; a character-count
        // estimate overshoots badly on long runs and would bridge the column
        // gutter, breaking the two-column detection below.
        const endX = x + (typeof it.width === "number" ? it.width : 0);
        return { str: it.str, x, y, endX };
      })
      .filter((it): it is TextItem => it !== null);

    // Walk the operator list, tracking the CTM stack, to find each embedded
    // image's placed position (page-space) and pixel data.
    const opList = await page.getOperatorList();
    const OPS = pdfjs.OPS;
    const images: ImagePlacement[] = [];
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const stack: Matrix[] = [];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      if (fn === OPS.save) {
        stack.push(ctm);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() ?? ctm;
      } else if (fn === OPS.transform) {
        const args = opList.argsArray[i] as number[];
        ctm = multiply(args as Matrix, ctm);
      } else if (fn === OPS.paintImageXObject) {
        try {
          const objId = opList.argsArray[i][0];
          // Images nested inside a Form XObject/group (soft masks, transparency
          // groups) are never populated without actually rendering the page, so
          // page.objs.get() would hang forever waiting on them — bound the wait.
          const img = await new Promise<{ width: number; height: number; data: Uint8ClampedArray | Uint8Array; kind: number }>(
            (resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("image object never resolved")), 500);
              page.objs.get(objId, (value: { width: number; height: number; data: Uint8ClampedArray | Uint8Array; kind: number }) => {
                clearTimeout(timer);
                resolve(value);
              });
            }
          );
          const corners = [applyPoint(ctm, 0, 0), applyPoint(ctm, 1, 0), applyPoint(ctm, 0, 1), applyPoint(ctm, 1, 1)];
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          const x0 = Math.min(...xs);
          const y1 = Math.max(...ys);
          const pngBuffer = encodePngFromImageData(img);
          if (pngBuffer) {
            images.push({ x: x0, y: y1, width: img.width, height: img.height, buffer: pngBuffer });
          }
        } catch {
          // Skip images we can't decode rather than failing the whole upload.
        }
      }
    }

    const boundary = detectColumnBoundary(textItems, viewport.width);
    const leftText = boundary === null ? textItems : textItems.filter((i) => i.x < boundary);
    const rightText = boundary === null ? [] : textItems.filter((i) => i.x >= boundary);
    const leftImages = boundary === null ? images : images.filter((i) => i.x < boundary);
    const rightImages = boundary === null ? [] : images.filter((i) => i.x >= boundary);

    const emitColumn = (
      lines: { y: number; text: string; fragments: TextFragment[] }[],
      imgs: ImagePlacement[]
    ) => {
      type Entry = { y: number; event: PdfEvent };
      const entries: Entry[] = [
        ...lines.map((l) => ({
          y: l.y,
          event: { kind: "text" as const, value: l.text, fragments: l.fragments, y: l.y },
        })),
        ...imgs.map((im) => ({ y: im.y, event: { kind: "image" as const, buffer: im.buffer, width: im.width, height: im.height } })),
      ];
      entries.sort((a, b) => b.y - a.y);
      for (const e of entries) events.push(e.event);
    };

    emitColumn(groupIntoLines(leftText), leftImages);
    emitColumn(groupIntoLines(rightText), rightImages);
    events.push({ kind: "pagebreak" });
  }

  return events;
}

// Minimal PNG encoder (no native deps) for the RGBA/RGB/greyscale pixel buffers
// pdf.js decodes embedded images into.
function encodePngFromImageData(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): Buffer | null {
  const { width, height, data } = img;
  const n = width * height;
  let rgba: Buffer;
  if (data.length === n * 4) {
    rgba = Buffer.from(data);
  } else if (data.length === n * 3) {
    rgba = Buffer.alloc(n * 4);
    for (let p = 0; p < n; p++) {
      rgba[p * 4] = data[p * 3];
      rgba[p * 4 + 1] = data[p * 3 + 1];
      rgba[p * 4 + 2] = data[p * 3 + 2];
      rgba[p * 4 + 3] = 255;
    }
  } else if (data.length === n) {
    rgba = Buffer.alloc(n * 4);
    for (let p = 0; p < n; p++) {
      rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = data[p];
      rgba[p * 4 + 3] = 255;
    }
  } else {
    return null;
  }
  return encodePNG(rgba, width, height);
}

function crc32(buf: Buffer): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

let cachedTable: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (cachedTable) return cachedTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  cachedTable = t;
  return t;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(rgba: Buffer, width: number, height: number): Buffer {
  // Requires the "zlib" Node builtin for DEFLATE compression of scanlines.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require("zlib") as typeof import("zlib");
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
