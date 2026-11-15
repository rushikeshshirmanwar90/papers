import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

// Color palette
const COLORS = {
  primary: rgb(0.06, 0.28, 0.22),     // Deep Forest Emerald
  primaryDark: rgb(0.04, 0.18, 0.14),
  accent: rgb(0.12, 0.58, 0.44),      // Jade Green
  accentLight: rgb(0.92, 0.98, 0.95), // Pale Mint
  secondary: rgb(0.15, 0.35, 0.55),   // Navy Slate
  darkText: rgb(0.08, 0.1, 0.12),
  bodyText: rgb(0.2, 0.23, 0.26),
  mutedText: rgb(0.45, 0.49, 0.53),
  codeBg: rgb(0.96, 0.97, 0.98),
  codeBorder: rgb(0.85, 0.88, 0.92),
  codeText: rgb(0.12, 0.18, 0.24),
  line: rgb(0.88, 0.91, 0.94),
  white: rgb(1, 1, 1),
  badgeBg: rgb(0.88, 0.95, 0.92),
  badgeText: rgb(0.08, 0.42, 0.3),
};

const PAGE_WIDTH = 595.28;  // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 45;
const MARGIN_RIGHT = 45;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 505.28
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 48;

class DocBuilder {
  doc!: PDFDocument;
  fontRegular!: PDFFont;
  fontBold!: PDFFont;
  fontMono!: PDFFont;
  fontMonoBold!: PDFFont;
  pages: PDFPage[] = [];
  currentPage!: PDFPage;
  cursorY: number = 0;
  pageNum: number = 0;

  static async create(): Promise<DocBuilder> {
    const builder = new DocBuilder();
    builder.doc = await PDFDocument.create();
    builder.fontRegular = await builder.doc.embedFont(StandardFonts.Helvetica);
    builder.fontBold = await builder.doc.embedFont(StandardFonts.HelveticaBold);
    builder.fontMono = await builder.doc.embedFont(StandardFonts.Courier);
    builder.fontMonoBold = await builder.doc.embedFont(StandardFonts.CourierBold);
    return builder;
  }

  newPage(): void {
    this.pageNum++;
    this.currentPage = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.currentPage);
    this.cursorY = PAGE_HEIGHT - MARGIN_TOP;

    // Running Header (except on page 1)
    if (this.pageNum > 1) {
      this.currentPage.drawText("NCERT TEXTBOOK API - DEVELOPER & INTEGRATION GUIDE", {
        x: MARGIN_LEFT,
        y: PAGE_HEIGHT - 28,
        size: 7.5,
        font: this.fontBold,
        color: COLORS.mutedText,
      });

      this.currentPage.drawLine({
        start: { x: MARGIN_LEFT, y: PAGE_HEIGHT - 34 },
        end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: PAGE_HEIGHT - 34 },
        thickness: 0.5,
        color: COLORS.line,
      });
    }
  }

  checkSpace(requiredHeight: number): void {
    if (this.cursorY - requiredHeight < MARGIN_BOTTOM) {
      this.newPage();
    }
  }

  drawHeroBanner(title: string, subtitle: string, metaItems: string[]): void {
    const bannerHeight = 115;
    this.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: this.cursorY - bannerHeight,
      width: CONTENT_WIDTH,
      height: bannerHeight,
      color: COLORS.primary,
      borderWidth: 0,
    });

    // Decorative accent stripe
    this.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: this.cursorY - bannerHeight,
      width: CONTENT_WIDTH,
      height: 4,
      color: COLORS.accent,
    });

    // Tag
    this.currentPage.drawText("OFFICIAL DEVELOPER MANUAL", {
      x: MARGIN_LEFT + 20,
      y: this.cursorY - 26,
      size: 8.5,
      font: this.fontBold,
      color: COLORS.accent,
    });

    // Main Title
    this.currentPage.drawText(title, {
      x: MARGIN_LEFT + 20,
      y: this.cursorY - 50,
      size: 19,
      font: this.fontBold,
      color: COLORS.white,
    });

    // Subtitle
    this.currentPage.drawText(subtitle, {
      x: MARGIN_LEFT + 20,
      y: this.cursorY - 72,
      size: 10,
      font: this.fontRegular,
      color: rgb(0.85, 0.92, 0.88),
    });

    // Meta Badges
    let badgeX = MARGIN_LEFT + 20;
    const badgeY = this.cursorY - 98;
    for (const item of metaItems) {
      const textWidth = this.fontBold.widthOfTextAtSize(item, 8);
      this.currentPage.drawRectangle({
        x: badgeX,
        y: badgeY,
        width: textWidth + 12,
        height: 16,
        color: rgb(0.12, 0.38, 0.3),
        borderRadius: 3,
      });
      this.currentPage.drawText(item, {
        x: badgeX + 6,
        y: badgeY + 4,
        size: 7.5,
        font: this.fontBold,
        color: COLORS.white,
      });
      badgeX += textWidth + 18;
    }

    this.cursorY -= bannerHeight + 22;
  }

  drawSectionHeading(title: string, tag?: string): void {
    this.checkSpace(48);
    this.cursorY -= 8;

    if (tag) {
      const tagWidth = this.fontBold.widthOfTextAtSize(tag.toUpperCase(), 7);
      this.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: this.cursorY - 14,
        width: tagWidth + 8,
        height: 13,
        color: COLORS.badgeBg,
      });
      this.currentPage.drawText(tag.toUpperCase(), {
        x: MARGIN_LEFT + 4,
        y: this.cursorY - 10,
        size: 7,
        font: this.fontBold,
        color: COLORS.badgeText,
      });
      this.cursorY -= 18;
    }

    this.currentPage.drawText(title, {
      x: MARGIN_LEFT,
      y: this.cursorY - 14,
      size: 14,
      font: this.fontBold,
      color: COLORS.primary,
    });

    this.currentPage.drawLine({
      start: { x: MARGIN_LEFT, y: this.cursorY - 20 },
      end: { x: MARGIN_LEFT + 120, y: this.cursorY - 20 },
      thickness: 2,
      color: COLORS.accent,
    });

    this.currentPage.drawLine({
      start: { x: MARGIN_LEFT + 120, y: this.cursorY - 20 },
      end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: this.cursorY - 20 },
      thickness: 0.5,
      color: COLORS.line,
    });

    this.cursorY -= 30;
  }

  drawSubheading(title: string): void {
    this.checkSpace(28);
    this.cursorY -= 4;
    this.currentPage.drawText(title, {
      x: MARGIN_LEFT,
      y: this.cursorY - 11,
      size: 11,
      font: this.fontBold,
      color: COLORS.secondary,
    });
    this.cursorY -= 18;
  }

  drawParagraph(text: string, options?: { isBold?: boolean; size?: number; color?: any }): void {
    const size = options?.size ?? 9.5;
    const font = options?.isBold ? this.fontBold : this.fontRegular;
    const color = options?.color ?? COLORS.bodyText;
    const lineHeight = size * 1.45;

    const words = text.split(" ");
    let line = "";

    for (const w of words) {
      const testLine = line ? `${line} ${w}` : w;
      const testWidth = font.widthOfTextAtSize(testLine, size);

      if (testWidth > CONTENT_WIDTH) {
        this.checkSpace(lineHeight);
        this.currentPage.drawText(line, {
          x: MARGIN_LEFT,
          y: this.cursorY - size,
          size,
          font,
          color,
        });
        this.cursorY -= lineHeight;
        line = w;
      } else {
        line = testLine;
      }
    }

    if (line) {
      this.checkSpace(lineHeight);
      this.currentPage.drawText(line, {
        x: MARGIN_LEFT,
        y: this.cursorY - size,
        size,
        font,
        color,
      });
      this.cursorY -= lineHeight;
    }

    this.cursorY -= 4;
  }

  drawCallout(text: string, title: string = "PRO TIP"): void {
    this.checkSpace(45);
    const boxHeight = 38;
    this.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: this.cursorY - boxHeight,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: COLORS.accentLight,
      borderColor: COLORS.accent,
      borderWidth: 1,
      borderRadius: 4,
    });

    this.currentPage.drawText(`*  ${title}:`, {
      x: MARGIN_LEFT + 12,
      y: this.cursorY - 14,
      size: 8.5,
      font: this.fontBold,
      color: COLORS.primaryDark,
    });

    this.currentPage.drawText(text, {
      x: MARGIN_LEFT + 12,
      y: this.cursorY - 27,
      size: 8.5,
      font: this.fontRegular,
      color: COLORS.bodyText,
    });

    this.cursorY -= boxHeight + 10;
  }

  drawCodeBlock(codeLines: string[], label?: string): void {
    const fontSize = 8;
    const lineHeight = 12.5;
    const paddingY = 8;
    const headerHeight = label ? 18 : 0;
    const blockHeight = codeLines.length * lineHeight + paddingY * 2 + headerHeight;

    this.checkSpace(blockHeight + 10);

    // Block background
    this.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: this.cursorY - blockHeight,
      width: CONTENT_WIDTH,
      height: blockHeight,
      color: COLORS.codeBg,
      borderColor: COLORS.codeBorder,
      borderWidth: 1,
      borderRadius: 4,
    });

    // Optional header strip
    if (label) {
      this.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: this.cursorY - headerHeight,
        width: CONTENT_WIDTH,
        height: headerHeight,
        color: rgb(0.91, 0.93, 0.95),
      });

      this.currentPage.drawText(label.toUpperCase(), {
        x: MARGIN_LEFT + 10,
        y: this.cursorY - 12,
        size: 7.5,
        font: this.fontMonoBold,
        color: COLORS.secondary,
      });

      this.currentPage.drawLine({
        start: { x: MARGIN_LEFT, y: this.cursorY - headerHeight },
        end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: this.cursorY - headerHeight },
        thickness: 0.5,
        color: COLORS.codeBorder,
      });
    }

    let lineY = this.cursorY - headerHeight - paddingY - fontSize;
    for (const line of codeLines) {
      this.currentPage.drawText(line, {
        x: MARGIN_LEFT + 12,
        y: lineY,
        size: fontSize,
        font: this.fontMono,
        color: COLORS.codeText,
      });
      lineY -= lineHeight;
    }

    this.cursorY -= blockHeight + 12;
  }

  drawTable(headers: string[], rows: string[][], colWidths: number[]): void {
    const rowHeight = 20;
    const totalTableHeight = (rows.length + 1) * rowHeight;
    this.checkSpace(totalTableHeight + 12);

    // Header background
    this.currentPage.drawRectangle({
      x: MARGIN_LEFT,
      y: this.cursorY - rowHeight,
      width: CONTENT_WIDTH,
      height: rowHeight,
      color: COLORS.primaryDark,
    });

    // Header texts
    let curX = MARGIN_LEFT;
    for (let i = 0; i < headers.length; i++) {
      this.currentPage.drawText(headers[i], {
        x: curX + 6,
        y: this.cursorY - 14,
        size: 8,
        font: this.fontBold,
        color: COLORS.white,
      });
      curX += colWidths[i];
    }
    this.cursorY -= rowHeight;

    // Data rows
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const isEven = r % 2 === 0;

      this.currentPage.drawRectangle({
        x: MARGIN_LEFT,
        y: this.cursorY - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: isEven ? COLORS.white : rgb(0.97, 0.98, 0.99),
        borderColor: COLORS.line,
        borderWidth: 0.5,
      });

      curX = MARGIN_LEFT;
      for (let c = 0; c < row.length; c++) {
        const text = row[c];
        const isParam = c === 0;
        this.currentPage.drawText(text, {
          x: curX + 6,
          y: this.cursorY - 14,
          size: 7.5,
          font: isParam ? this.fontMonoBold : this.fontRegular,
          color: isParam ? COLORS.primary : COLORS.bodyText,
        });
        curX += colWidths[c];
      }
      this.cursorY -= rowHeight;
    }

    this.cursorY -= 12;
  }

  addFooters(): void {
    const totalPages = this.pages.length;
    for (let i = 0; i < totalPages; i++) {
      const p = this.pages[i];

      p.drawLine({
        start: { x: MARGIN_LEFT, y: 34 },
        end: { x: PAGE_WIDTH - MARGIN_RIGHT, y: 34 },
        thickness: 0.5,
        color: COLORS.line,
      });

      p.drawText("Vedclass PCMB Paper - Confidential & Developer Documentation", {
        x: MARGIN_LEFT,
        y: 22,
        size: 7.5,
        font: this.fontRegular,
        color: COLORS.mutedText,
      });

      const pageStr = `Page ${i + 1} of ${totalPages}`;
      const pageStrWidth = this.fontRegular.widthOfTextAtSize(pageStr, 7.5);
      p.drawText(pageStr, {
        x: PAGE_WIDTH - MARGIN_RIGHT - pageStrWidth,
        y: 22,
        size: 7.5,
        font: this.fontBold,
        color: COLORS.mutedText,
      });
    }
  }

  async save(outputPath: string): Promise<void> {
    this.addFooters();
    const pdfBytes = await this.doc.save();
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, pdfBytes);
  }
}

async function buildGuide(): Promise<void> {
  const b = await DocBuilder.create();

  // =========================================================================
  // PAGE 1: Cover & Architecture Overview
  // =========================================================================
  b.newPage();
  b.drawHeroBanner(
    "NCERT Textbook API Reference",
    "Complete developer manual for querying curriculum, chapters, topics & merged PDFs",
    ["8 Unified Subjects", "106 Total Chapters", "634 Topics", "5 Marks / Chapter", "MongoDB Seeded"]
  );

  b.drawSectionHeading("1. Architectural Overview", "Foundation");
  b.drawParagraph(
    "The NCERT Textbook system provides standardized access to Class 11 and 12 textbooks (Physics, Chemistry, Mathematics, and Biology). Each subject is stored in MongoDB as a single unified document where multi-volume books (e.g., Part 1 & Part 2) are seamlessly aggregated into one sequential chapter list (Chapters 1 through 14)."
  );

  b.drawCallout(
    "Every chapter carries an exam weightage of exactly 5 marks, and textbooks report verified totalMarks (e.g. 14 chapters = 70 marks).",
    "UNIFIED CATALOG DESIGN"
  );

  b.drawSubheading("Base Service URLs & Endpoints");
  b.drawParagraph(
    "The Textbook APIs are available both within the Next.js full-stack app (connecting directly to MongoDB) and the local Python Extractor server:"
  );

  b.drawTable(
    ["Environment", "Endpoint", "Type", "Description"],
    [
      ["Next.js Web App", "GET /api/textbook", "JSON", "Full curriculum queries against MongoDB"],
      ["Next.js PDF Engine", "GET /api/textbook/pdf", "Binary PDF", "Dynamic chapter streaming & merging"],
      ["Extractor Server", "GET /api/textbook/query", "JSON", "Local metadata queries on port 8765"],
      ["Extractor PDF", "GET /api/textbook/pdf", "Binary PDF", "Local pypdf chapter streaming & merging"],
    ],
    [105, 135, 75, 190]
  );

  b.drawSubheading("Unified Subject Catalog in MongoDB");
  b.drawTable(
    ["Standard", "Subject", "Total Chapters", "Marks / Chapter", "Total Marks"],
    [
      ["11th", "Physics", "14 Chapters (Part 1: 7 ch + Part 2: 7 ch)", "5 marks", "70 marks"],
      ["11th", "Chemistry", "9 Chapters (Part 1: 6 ch + Part 2: 3 ch)", "5 marks", "45 marks"],
      ["11th", "Mathematics", "14 Chapters (Full syllabus)", "5 marks", "70 marks"],
      ["11th", "Biology", "19 Chapters (Full syllabus)", "5 marks", "95 marks"],
      ["12th", "Physics", "14 Chapters (Part 1: 8 ch + Part 2: 6 ch)", "5 marks", "70 marks"],
      ["12th", "Chemistry", "10 Chapters (Part 1: 5 ch + Part 2: 5 ch)", "5 marks", "50 marks"],
      ["12th", "Mathematics", "13 Chapters (Part 1: 6 ch + Part 2: 7 ch)", "5 marks", "65 marks"],
      ["12th", "Biology", "13 Chapters (Full syllabus)", "5 marks", "65 marks"],
    ],
    [50, 75, 230, 80, 70]
  );

  // =========================================================================
  // PAGE 2: Query Parameters & Status Codes
  // =========================================================================
  b.newPage();
  b.drawSectionHeading("2. Parameter Specification & Response Types", "Parameters");
  b.drawParagraph(
    "All queries to /api/textbook or /api/textbook/query use HTTP GET query parameters. Parameters are case-insensitive and support both numbers and natural language titles."
  );

  b.drawTable(
    ["Parameter", "Type", "Example", "Description"],
    [
      ["standard", "string", "12th or class-12", "Target academic class (11th or 12th). Required."],
      ["subject", "string", "Physics", "Subject name (Physics, Chemistry, Mathematics, Biology)."],
      ["chapter", "string/int", "1 or Electrostatics", "Fetches a single whole chapter by number, name, or slug."],
      ["chapters", "string", "1,2,3 or Matrices,Det", "Comma-separated list of chapters to fetch in batch."],
      ["topic", "string", "Coulomb's Law or 1.5", "Fetches a single topic by title or section number."],
      ["topics", "string", "Electric Charge,Coulomb", "Comma-separated list of topic keywords or names."],
      ["search", "string", "magnetic", "Performs full-text keyword search across chapters and topics."],
      ["download", "boolean", "true", "Forces 'Content-Disposition: attachment' for PDF downloads."],
    ],
    [75, 65, 110, 255]
  );

  b.drawSubheading("Standard Response Envelope ('kind')");
  b.drawParagraph(
    "The API responds with an explicit 'kind' discriminator property that identifies the structure of the payload:"
  );

  b.drawTable(
    ["Value of 'kind'", "Returned Fields", "Typical Usage"],
    [
      ["single_chapter", "standard, subject, chapter", "Detailed single chapter study, page count, topics"],
      ["multiple_chapters", "count, totalMarks, chapters[]", "Test blueprint creation, unit revision bundles"],
      ["single_topic", "standard, subject, chapterName, topic", "Targeted concept card or video lesson lookup"],
      ["multiple_topics", "count, topics[]", "Multi-topic quiz generation across chapters"],
      ["single_textbook", "title, totalChapters, totalMarks, chapters[]", "Full subject syllabus view with all chapters"],
      ["search", "query, count, results[]", "Search bar autocomplete and concept discovery"],
    ],
    [95, 210, 200]
  );

  b.drawSubheading("HTTP Status Codes");
  b.drawCodeBlock([
    "200 OK          - Query succeeded; payload returned in requested structure.",
    "400 Bad Request - Missing mandatory standard or subject parameters.",
    "404 Not Found   - Specified chapter, topic, or subject does not exist.",
    "500 Server Err  - Database connection or unexpected server failure.",
  ], "HTTP Status Codes");

  // =========================================================================
  // PAGE 3: Use Case 1 - Single Whole Chapter
  // =========================================================================
  b.newPage();
  b.drawSectionHeading("3. Use Case 1: Fetch a Whole Chapter", "Scenario 1");
  b.drawParagraph(
    "Use this scenario when an application needs the full metadata for a chapter: its official NCERT title, assigned weightage marks (5 marks), local PDF file path, total page count, and all section topics with their official section numbers."
  );

  b.drawSubheading("Sample Request (by Chapter Number)");
  b.drawCodeBlock([
    "# Fetch Class 12 Physics Chapter 1 via cURL:",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Physics&chapter=1'",
  ], "cURL Request");

  b.drawSubheading("Sample Request (by Chapter Title / Slug)");
  b.drawCodeBlock([
    "# Natural language chapter name matching:",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Physics&chapter=Electric%20Charges%20and%20Fields'",
  ], "cURL Request");

  b.drawSubheading("Sample JSON Response");
  b.drawCodeBlock([
    "{",
    '  "ok": true,',
    '  "kind": "single_chapter",',
    '  "standard": "12th",',
    '  "subject": "Physics",',
    '  "chapter": {',
    '    "chapterNumber": 1,',
    '    "name": "Electric Charges and Fields",',
    '    "slug": "electric-charges-and-fields",',
    '    "marks": 5,',
    '    "part": 1,',
    '    "pages": 44,',
    '    "code": "leph101",',
    '    "pdfPath": "ncert_books/jee/physics/class-12/part-1/leph101.pdf",',
    '    "totalTopics": 13,',
    '    "topics": [',
    '      { "topicNumber": "1.1", "name": "Introduction", "slug": "introduction" },',
    '      { "topicNumber": "1.2", "name": "Electric Charge", "slug": "electric-charge" },',
    '      { "topicNumber": "1.3", "name": "Conductors and Insulators", "slug": "conductors-and-insulators" },',
    '      { "topicNumber": "1.4", "name": "Basic Properties of Electric Charge", "slug": "basic-properties..." },',
    '      { "topicNumber": "1.5", "name": "Coulomb\'s Law", "slug": "coulombs-law" }',
    "    ]",
    "  }",
    "}",
  ], "Response Payload (JSON)");

  b.drawSubheading("Frontend Client Snippet (TypeScript)");
  b.drawCodeBlock([
    "async function fetchChapter(standard: string, subject: string, chapter: number) {",
    "  const res = await fetch(`/api/textbook?standard=${standard}&subject=${subject}&chapter=${chapter}`);",
    "  const { chapter: data } = await res.json();",
    "  console.log(`Loaded ${data.name}: ${data.pages} pages, ${data.marks} marks`);",
    "  return data;",
    "}",
  ], "TypeScript Integration");

  // =========================================================================
  // PAGE 4: Use Case 2 - Multiple Chapters (Batching)
  // =========================================================================
  b.newPage();
  b.drawSectionHeading("4. Use Case 2: Fetch Multiple Chapters", "Scenario 2");
  b.drawParagraph(
    "Use this scenario when assembling unit exams, periodic assessments, or multi-chapter revision plans. The API accepts comma-separated chapter numbers or titles, aggregates them, and calculates the cumulative totalMarks automatically."
  );

  b.drawSubheading("Sample Request (Batch by Numbers)");
  b.drawCodeBlock([
    "# Fetch Electrostatics & Current Electricity (Chapters 1, 2, and 3):",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Physics&chapters=1,2,3'",
  ], "cURL Request");

  b.drawSubheading("Sample Request (Batch by Chapter Names)");
  b.drawCodeBlock([
    "# Fetch Mathematics Algebra Unit:",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Mathematics&chapters=Matrices,Determinants'",
  ], "cURL Request");

  b.drawSubheading("Sample JSON Response");
  b.drawCodeBlock([
    "{",
    '  "ok": true,',
    '  "kind": "multiple_chapters",',
    '  "count": 2,',
    '  "totalMarks": 10,',
    '  "chapters": [',
    "    {",
    '      "standard": "12th", "subject": "Physics",',
    '      "chapterNumber": 1,',
    '      "name": "Electric Charges and Fields",',
    '      "marks": 5, "pages": 44,',
    '      "pdfPath": "ncert_books/jee/physics/class-12/part-1/leph101.pdf",',
    '      "topics": [ ... ]',
    "    },",
    "    {",
    '      "standard": "12th", "subject": "Physics",',
    '      "chapterNumber": 2,',
    '      "name": "Electrostatic Potential and Capacitance",',
    '      "marks": 5, "pages": 40,',
    '      "pdfPath": "ncert_books/jee/physics/class-12/part-1/leph102.pdf",',
    '      "topics": [ ... ]',
    "    }",
    "  ]",
    "}",
  ], "Response Payload (JSON)");

  b.drawSubheading("Python Integration Example");
  b.drawCodeBlock([
    "import requests",
    "",
    "def get_test_syllabus(std: str, subject: str, ch_list: list[int]):",
    "    chs_param = ','.join(map(str, ch_list))",
    "    resp = requests.get('http://localhost:3000/api/textbook', params={",
    "        'standard': std, 'subject': subject, 'chapters': chs_param",
    "    })",
    "    data = resp.json()",
    "    print(f\"Exam: {data['count']} chapters | Total Marks: {data['totalMarks']}\")",
    "    return data['chapters']",
  ], "Python Client");

  // =========================================================================
  // PAGE 5: Use Cases 3 & 4 - Single and Multiple Topics
  // =========================================================================
  b.newPage();
  b.drawSectionHeading("5. Use Cases 3 & 4: Querying Topics", "Scenarios 3 & 4");
  b.drawParagraph(
    "Fine-grained querying allows teachers, students, and quiz-generation engines to retrieve specific concept units without loading entire books. You can query topics by official section numbers (e.g. '1.5') or topic titles."
  );

  b.drawSubheading("Use Case 3: Fetch a Single Topic");
  b.drawCodeBlock([
    "# Fetch Coulomb's Law from Chapter 1:",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Physics&chapter=1&topic=Coulomb%27s%20Law'",
    "",
    "# Alternatively, query by section number:",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Physics&chapter=1&topic=1.5'",
  ], "cURL Request");

  b.drawCodeBlock([
    "{",
    '  "ok": true,',
    '  "kind": "single_topic",',
    '  "count": 1,',
    '  "topics": {',
    '    "standard": "12th",',
    '    "subject": "Physics",',
    '    "chapterNumber": 1,',
    '    "chapterName": "Electric Charges and Fields",',
    '    "chapterMarks": 5,',
    '    "topic": {',
    '      "topicNumber": "1.5",',
    '      "name": "Coulomb\'s Law",',
    '      "slug": "coulombs-law"',
    "    }",
    "  }",
    "}",
  ], "Single Topic Response (JSON)");

  b.drawSubheading("Use Case 4: Fetch Multiple Topics");
  b.drawCodeBlock([
    "# Query multiple topics across an entire subject:",
    "curl -X GET 'http://localhost:3000/api/textbook?standard=12th&subject=Physics&topics=Coulomb,Capacitor'",
  ], "cURL Request");

  b.drawCodeBlock([
    "{",
    '  "ok": true,',
    '  "kind": "multiple_topics",',
    '  "count": 2,',
    '  "topics": [',
    '    { "chapterNumber": 1, "topic": { "topicNumber": "1.5", "name": "Coulomb\'s Law" } },',
    '    { "chapterNumber": 2, "topic": { "topicNumber": "2.12", "name": "Capacitors and Capacitance" } }',
    "  ]",
    "}",
  ], "Multiple Topics Response (JSON)");

  // =========================================================================
  // PAGE 6: Dynamic PDF Merging & Download Service
  // =========================================================================
  b.newPage();
  b.drawSectionHeading("6. On-the-Fly PDF Generation & Merging", "PDF Service");
  b.drawParagraph(
    "The Textbook PDF service dynamically streams original NCERT PDFs or merges multiple chapters on the fly into a single, printable PDF document with proper bookmarks and headers."
  );

  b.drawSubheading("PDF Streaming & Merging Endpoints");
  b.drawTable(
    ["Goal", "Method", "Request URL", "Behavior"],
    [
      ["View Chapter PDF", "GET", "/api/textbook/pdf?standard=12th&subject=Physics&chapter=1", "Streams PDF inline in browser"],
      ["Merge Chapters", "GET", "/api/textbook/pdf?standard=12th&subject=Physics&chapters=1,2", "Merges Ch 1 & 2 into 1 PDF"],
      ["Download PDF", "GET", "/api/textbook/pdf?standard=12th&subject=Physics&chapters=1,2&download=true", "Forces browser file download"],
    ],
    [95, 45, 235, 130]
  );

  b.drawSubheading("Sample cURL Commands for PDF Download");
  b.drawCodeBlock([
    "# 1. Download Chapter 1 PDF directly:",
    "curl -o Ch1_Electrostatics.pdf 'http://localhost:3000/api/textbook/pdf?standard=12th&subject=Physics&chapter=1'",
    "",
    "# 2. Download combined Chapters 1, 2, and 3 as one PDF file:",
    "curl -o Physics_Unit1_Unit2.pdf 'http://localhost:3000/api/textbook/pdf?standard=12th&subject=Physics&chapters=1,2,3'",
  ], "cURL Download Commands");

  b.drawSubheading("Command Line CLI Generator");
  b.drawParagraph(
    "You can also generate and merge PDFs from the terminal using the standalone Python generator:"
  );
  b.drawCodeBlock([
    "# Generate merged PDF for Mathematics Chapters 1, 2, and 3:",
    "python extractor/generate_pdf.py --std 12th --subject Mathematics --chapters 1,2,3 --output output/Maths_Unit1.pdf",
    "",
    "# Output: [v] Generated PDF: output/Maths_Unit1.pdf (62 pages, 15 marks)",
  ], "Terminal CLI");

  b.drawSubheading("Web Frontend Download Link (React / Next.js)");
  b.drawCodeBlock([
    '<a href="/api/textbook/pdf?standard=12th&subject=Physics&chapters=1,2&download=true"',
    '   className="btn-download" target="_blank">',
    "   Download Combined PDF (Chapters 1 & 2)",
    "</a>",
  ], "React Download Button");

  // =========================================================================
  // PAGE 7: Database Direct Queries & Summary Reference
  // =========================================================================
  b.newPage();
  b.drawSectionHeading("7. Database Querying & Production Reference", "Reference");
  b.drawParagraph(
    "For backend microservices and background workers that interact directly with MongoDB, here is how to query the 'textbooks' collection using Mongoose (Node.js) and PyMongo (Python)."
  );

  b.drawSubheading("Direct Database Query in Node.js (Mongoose)");
  b.drawCodeBlock([
    'import Textbook from "@/models/Textbook";',
    'import { connectDB } from "@/lib/db";',
    "",
    "async function getSubjectWithMarks(standard: string, subject: string) {",
    "  await connectDB();",
    "  const doc = await Textbook.findOne({ standard, subject }).lean();",
    "  console.log(`${doc.title}: ${doc.totalChapters} chapters, ${doc.totalMarks} marks`);",
    "  return doc.chapters.map(c => ({ number: c.chapterNumber, title: c.name, marks: c.marks }));",
    "}",
  ], "Node.js (Mongoose)");

  b.drawSubheading("Direct Database Query in Python (PyMongo)");
  b.drawCodeBlock([
    "from pymongo import MongoClient",
    "",
    "client = MongoClient('mongodb+srv://.../?retryWrites=true&w=majority')",
    "db = client['pcmb']",
    "col = db['textbooks']",
    "",
    "# Query Class 12 Physics document (1 unified entry):",
    "physics = col.find_one({'standard': '12th', 'subject': 'Physics'})",
    "print(f\"Found {physics['title']}: {physics['totalChapters']} chapters, {physics['totalMarks']} total marks\")",
    "for ch in physics['chapters']:",
    "    print(f\"  Ch {ch['chapterNumber']}: {ch['name']} ({ch.get('marks', 5)} marks)\")",
  ], "Python (PyMongo)");

  b.drawSubheading("Summary Table: All 8 Seeded Unified Textbooks");
  b.drawTable(
    ["Class", "Subject", "Total Ch", "Topics", "Marks/Ch", "Total Marks", "MongoDB Status"],
    [
      ["11th", "Physics", "14", "172", "5m", "70m", "Active (Unified)"],
      ["11th", "Chemistry", "9", "88", "5m", "45m", "Active (Unified)"],
      ["11th", "Mathematics", "14", "102", "5m", "70m", "Active (Unified)"],
      ["11th", "Biology", "19", "128", "5m", "95m", "Active (Unified)"],
      ["12th", "Physics", "14", "172", "5m", "70m", "Active (Unified)"],
      ["12th", "Chemistry", "10", "94", "5m", "50m", "Active (Unified)"],
      ["12th", "Mathematics", "13", "98", "5m", "65m", "Active (Unified)"],
      ["12th", "Biology", "13", "92", "5m", "65m", "Active (Unified)"],
    ],
    [40, 75, 45, 45, 55, 65, 180]
  );

  // Save the guide in multiple accessible locations
  const outPath1 = path.resolve(process.cwd(), "../extractor/output/Textbook_API_Developer_Guide.pdf");
  const outPath2 = path.resolve(process.cwd(), "public/Textbook_API_Developer_Guide.pdf");

  await b.save(outPath1);
  await b.save(outPath2);
  console.log(`[v] Guide successfully generated: ${outPath1} (${b.pages.length} pages)`);
}

buildGuide().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
