import { Schema, model, models, type Document, type Types } from "mongoose";

export const JOIN_STATUSES = ["pending", "accepted", "rejected", "cancelled"] as const;
export type JoinStatus = (typeof JOIN_STATUSES)[number];

/**
 * Someone who registered asks a tuition to let them in, using its join code.
 * The tuition accepts them as a student or a teacher, or rejects them.
 */
export interface JoinRequestDoc extends Document {
  userId: Types.ObjectId;
  tuitionId: Types.ObjectId;
  status: JoinStatus;
  /** What they were accepted as. */
  acceptedAs: "student" | "teacher" | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const JoinRequestSchema = new Schema<JoinRequestDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
    status: { type: String, enum: JOIN_STATUSES, default: "pending" },
    acceptedAs: { type: String, enum: ["student", "teacher", null], default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

JoinRequestSchema.index({ tuitionId: 1, status: 1, createdAt: -1 });

export default models.JoinRequest || model<JoinRequestDoc>("JoinRequest", JoinRequestSchema);
