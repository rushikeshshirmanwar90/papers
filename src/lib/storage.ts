import { Types } from "mongoose";
import { connectDB } from "./db";
import StoredFile from "@/models/StoredFile";

// Durable storage for uploaded PDFs and the diagram PNGs cut out of them.
//
// Files used to be written under public/uploads, which only works on a
// long-lived server with a writable disk. On Vercel the function bundle is a
// read-only filesystem (EROFS on /var/task) and public/ is fixed at build
// time, so anything written at runtime is neither persisted nor served.
// Instead the bytes live in the StoredFile collection alongside the paper
// they belong to, and /api/files/[id] serves them back.

export interface OpenedFile {
  filename: string;
  contentType: string;
  size: number;
  data: Buffer;
}

/** Public URL a stored file is served from. */
export const fileUrl = (id: Types.ObjectId | string) => `/api/files/${id}`;

/**
 * Stores a file and returns its public URL. `paperId` ties it to its paper so
 * that deleting the paper removes everything uploaded for it.
 */
export async function saveFile(
  buffer: Buffer,
  opts: { filename: string; contentType: string; kind: "pdf" | "diagram"; paperId: Types.ObjectId }
): Promise<string> {
  await connectDB();
  const doc = await StoredFile.create({
    paperId: opts.paperId,
    kind: opts.kind,
    filename: opts.filename,
    contentType: opts.contentType,
    size: buffer.length,
    data: buffer,
  });
  return fileUrl(doc._id);
}

/** Looks a stored file up by id; null when the id is malformed or unknown. */
export async function openFile(id: string): Promise<OpenedFile | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();
  // Not .lean(): a lean read hands back a BSON Binary, not a Buffer, and
  // only the schema cast turns the stored bytes into a real Buffer.
  const doc = await StoredFile.findById(id);
  if (!doc) return null;
  return { filename: doc.filename, contentType: doc.contentType, size: doc.size, data: doc.data };
}

/** Removes every file stored for a paper (its PDF and all its diagrams). */
export async function deleteFilesForPaper(paperId: Types.ObjectId | string): Promise<void> {
  await connectDB();
  await StoredFile.deleteMany({ paperId: new Types.ObjectId(paperId) });
}
