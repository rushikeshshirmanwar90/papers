import { Schema, model, models, type Document } from "mongoose";

/** A tuition class: the account that owns its teachers, students and batches. */
export interface TuitionDoc extends Document {
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
  /** Teachers sign up with this code; the tuition can change it. */
  joinCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TuitionSchema = new Schema<TuitionDoc>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    active: { type: Boolean, default: true },
    joinCode: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

export default models.Tuition || model<TuitionDoc>("Tuition", TuitionSchema);
