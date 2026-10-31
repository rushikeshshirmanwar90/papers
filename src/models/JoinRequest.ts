import { Schema, model, models, type Document, type Types } from "mongoose";

export const JOIN_STATUSES = ["pending", "accepted", "rejected", "cancelled"] as const;
export type JoinStatus = (typeof JOIN_STATUSES)[number];

/**
 * Someone who registered asks a tuition to let them in with a joining code.
 * The code decides the role, never the person: a batch's code makes a student
 * request, the institute's teacher code a teacher request. The tuition
 * approves or rejects it.
 */
export interface JoinRequestDoc extends Document {
  userId: Types.ObjectId;
  tuitionId: Types.ObjectId;
  status: JoinStatus;
  /** What the code they used lets them become. */
  role: "student" | "teacher";
  /** Set when the request came with a batch's joining code: they can only become a student of this batch. */
  batchId?: Types.ObjectId | null;
  /** Teacher requests: the subjects they said they can teach. */
  subjects: string[];
  /** What they were accepted as. */
  acceptedAs: "student" | "teacher" | null;
  decidedAt: Date | null;
  createdAt: Date;
}

const JoinRequestSchema = new Schema<JoinRequestDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
    role: { type: String, enum: ["student", "teacher"], default: "student" },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", default: null },
    subjects: { type: [String], default: [] },
    status: { type: String, enum: JOIN_STATUSES, default: "pending" },
    acceptedAs: { type: String, enum: ["student", "teacher", null], default: null },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

JoinRequestSchema.index({ tuitionId: 1, status: 1, createdAt: -1 });
// One pending request per person, even when two arrive at once.
JoinRequestSchema.index({ userId: 1 }, { name: "one_pending_per_user", unique: true, partialFilterExpression: { status: "pending" } });

export default models.JoinRequest || model<JoinRequestDoc>("JoinRequest", JoinRequestSchema);
