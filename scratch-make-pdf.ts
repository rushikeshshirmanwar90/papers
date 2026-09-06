import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFileSync } from "fs";

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const lineHeight = 18;
  const draw = (text: string, opts?: { bold?: boolean; size?: number }) => {
    page.drawText(text, { x: 50, y, size: opts?.size ?? 11, font: opts?.bold ? bold : font });
    y -= lineHeight;
  };

  draw("JEE Main 2024 Session 1", { bold: true, size: 14 });
  y -= 10;
  draw("PHYSICS", { bold: true });
  draw("SECTION - A");
  draw("1. A particle moves in a straight line with");
  draw("constant acceleration. Find its velocity.");
  draw("(A) 10 m/s");
  draw("(B) 20 m/s");
  draw("(C) 30 m/s");
  draw("(D) 40 m/s");
  draw("Ans. [B]");
  y -= 6;
  draw("2. What is the SI unit of force?");
  draw("(A) Joule");
  draw("(B) Watt");
  draw("(C) Newton");
  draw("(D) Pascal");
  draw("Ans. [C]");

  const bytes = await doc.save();
  writeFileSync("scratch-sample.pdf", bytes);
  console.log("wrote scratch-sample.pdf,", bytes.length, "bytes");
}

main();
