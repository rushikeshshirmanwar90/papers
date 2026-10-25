import { Schema, model, models, type Document, type Types } from "mongoose";

export const ANNOUNCEMENT_KINDS = ["schedule", "update"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

/** A notice to one or more batches: a schedule change or a small update. */
export interface AnnouncementDoc extends Document {
  tuitionId: Types.ObjectId;
  /** Empty: every batch of the tuition. */
  batchIds: Types.ObjectId[];
  kind: AnnouncementKind;
  title: string;
  body: string;
  authorId: Types.ObjectId;
  createdAt: Date;
}

const AnnouncementSchema = new Schema<AnnouncementDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
    batchIds: { type: [{ type: Schema.Types.ObjectId, ref: "Batch" }], default: [] },
    kind: { type: String, enum: ANNOUNCEMENT_KINDS, default: "update" },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: "", trim: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AnnouncementSchema.index({ tuitionId: 1, createdAt: -1 });

export default models.Announcement || model<AnnouncementDoc>("Announcement", AnnouncementSchema);
