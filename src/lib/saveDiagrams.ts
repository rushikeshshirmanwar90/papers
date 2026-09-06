import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const DIAGRAM_DIR = path.join(process.cwd(), "public", "uploads", "diagrams");

/**
 * Writes extracted diagram PNGs to public/uploads/diagrams and returns their
 * public URLs, in the same order as the input buffers.
 */
export async function saveDiagrams(buffers: Buffer[]): Promise<string[]> {
  if (buffers.length === 0) return [];
  await mkdir(DIAGRAM_DIR, { recursive: true });
  const urls: string[] = [];
  for (const buffer of buffers) {
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    await writeFile(path.join(DIAGRAM_DIR, name), buffer);
    urls.push(`/uploads/diagrams/${name}`);
  }
  return urls;
}
