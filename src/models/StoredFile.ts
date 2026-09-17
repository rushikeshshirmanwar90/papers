import { Schema, model, models, Types, type Document } from "mongoose";

// Binary content uploaded with a paper: the original PDF and the diagram
// PNGs cut out of it. Kept in the database rather than on disk, because a
// serverless deployment has no writable, persistent filesystem.
export interface StoredFileDoc extends Document {
  paperId: Types.ObjectId;
  kind: "pdf" | "diagram";
  filename: string;
  contentType: string;
  size: number;
  data: Buffer;
  createdAt: Date;
}

const StoredFileSchema = new Schema<StoredFileDoc>({
  paperId: { type: Schema.Types.ObjectId, ref: "Paper", required: true, index: true },
  kind: { type: String, enum: ["pdf", "diagram"], required: true },
  filename: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default models.StoredFile || model<StoredFileDoc>("StoredFile", StoredFileSchema);
