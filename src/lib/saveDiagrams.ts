import type { Types } from "mongoose";
import { uploadImageBuffer } from "./image-uploader";
import { saveFile } from "./storage";

const CLOUDINARY_FOLDER = "papers/diagrams";

/**
 * Uploads extracted diagram PNGs for a paper to Cloudinary and returns their
 * URLs, in the same order as the input buffers. Each image is tagged with
 * its paper's id so a paper's diagrams can be found (and purged) together in
 * the Cloudinary console.
 *
 * If Cloudinary rejects an image the diagram is kept in the database instead,
 * so a Cloudinary outage or preset change never loses a diagram or fails the
 * whole paper upload.
 */
export async function saveDiagrams(buffers: Buffer[], paperId: Types.ObjectId): Promise<string[]> {
  return Promise.all(
    buffers.map(async (buffer, i) => {
      const filename = `${paperId}-${i}.png`;
      try {
        return await uploadImageBuffer(buffer, {
          filename,
          contentType: "image/png",
          folder: CLOUDINARY_FOLDER,
          tags: [`paper:${paperId}`],
        });
      } catch (err) {
        console.warn(`Cloudinary upload failed for ${filename}, storing in database instead:`, err);
        return saveFile(buffer, { filename, contentType: "image/png", kind: "diagram", paperId });
      }
    })
  );
}
