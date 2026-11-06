import { Schema, model, models, type Document, type Types } from "mongoose";

/**
 * A tuition's logo, printed in the header of its exam papers. One per tuition,
 * kept apart from the Tuition document so reading a tuition never loads image
 * bytes. Only PNG and JPEG within a small size (lib/instituteLogo.ts).
 */
export interface InstituteLogoDoc extends Document {
  tuitionId: Types.ObjectId;
  contentType: "image/png" | "image/jpeg";
  size: number;
  width: number;
  height: number;
  data: Buffer;
  updatedBy: Types.ObjectId;
  updatedAt: Date;
}

const InstituteLogoSchema = new Schema<InstituteLogoDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true, unique: true },
    contentType: { type: String, enum: ["image/png", "image/jpeg"], required: true },
    size: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    data: { type: Buffer, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export default models.InstituteLogo || model<InstituteLogoDoc>("InstituteLogo", InstituteLogoSchema);
