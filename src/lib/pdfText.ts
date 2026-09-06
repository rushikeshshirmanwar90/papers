// Extracts plain text lines from a PDF buffer using pdf.js's legacy Node build.
// Text items are grouped into lines by their vertical (y) position so that
// question/option/answer markers that pdf.js would otherwise flatten into one
// long string stay on separate lines, which the question parser depends on.
export async function extractLinesFromPdf(buffer: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  const lines: string[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    type Item = { str: string; x: number; y: number };
    const items: Item[] = content.items
      .map((it) => {
        if (!("str" in it)) return null;
        return { str: it.str, x: it.transform[4], y: it.transform[5] };
      })
      .filter((it): it is Item => it !== null && it.str.trim().length > 0);

    // Group items whose y-coordinates are close together into the same line.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const rowGroups: Item[][] = [];
    const Y_TOLERANCE = 2.5;
    for (const item of items) {
      const lastGroup = rowGroups[rowGroups.length - 1];
      if (lastGroup && Math.abs(lastGroup[0].y - item.y) <= Y_TOLERANCE) {
        lastGroup.push(item);
      } else {
        rowGroups.push([item]);
      }
    }

    for (const group of rowGroups) {
      group.sort((a, b) => a.x - b.x);
      const line = group
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) lines.push(line);
    }

    lines.push(""); // page boundary marker
  }

  return lines;
}
