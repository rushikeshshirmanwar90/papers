import { Schema, model, models, type Document, type Types } from "mongoose";

export const INVITE_STATUSES = ["active", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/**
 * The code students join one batch with. One document per batch: a new code
 * replaces the old one in place, so the old code stops working at once. The
 * code itself is kept only as a keyed hash (to look it up) and as ciphertext
 * (so the tuition can read it again); never as plain text.
 */
export interface BatchInviteDoc extends Document {
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId;
  status: InviteStatus;
  /** HMAC of the code; absent once revoked. */
  codeHash?: string;
  /** AES-GCM of the code; absent once revoked. */
  codeCipher?: string;
  /** null: never expires. */
  expiresAt: Date | null;
  createdBy: Types.ObjectId | null;
  rotatedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const BatchInviteSchema = new Schema<BatchInviteDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, unique: true },
    status: { type: String, enum: INVITE_STATUSES, default: "active" },
    codeHash: { type: String, unique: true, sparse: true },
    codeCipher: { type: String },
    expiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rotatedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default models.BatchInvite || model<BatchInviteDoc>("BatchInvite", BatchInviteSchema);
