import { Schema, model, models, type Document } from "mongoose";

export const CODE_PURPOSES = ["verify-email", "reset-password"] as const;
export type CodePurpose = (typeof CODE_PURPOSES)[number];

/**
 * A one-time code sent by email. Only its hash is kept; it expires on its
 * own (the TTL index removes it) and allows a few wrong tries.
 */
export interface EmailCodeDoc extends Document {
  email: string;
  purpose: CodePurpose;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const EmailCodeSchema = new Schema<EmailCodeDoc>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, enum: CODE_PURPOSES, required: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

EmailCodeSchema.index({ email: 1, purpose: 1, createdAt: -1 });

export default models.EmailCode || model<EmailCodeDoc>("EmailCode", EmailCodeSchema);
