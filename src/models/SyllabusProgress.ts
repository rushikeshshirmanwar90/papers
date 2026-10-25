import { Schema, model, models, type Document, type Types } from "mongoose";
import { STANDARDS, SUBJECTS, type SchoolStandard, type SchoolSubject } from "@/lib/school";

/**
 * One topic a batch has been taught, and when. A chapter without named
 * topics is covered as a whole (topic "").
 */
export interface SyllabusProgressDoc extends Document {
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId;
  subject: SchoolSubject;
  standard: SchoolStandard;
  chapter: string;
  topic: string;
  coveredOn: Date;
  teacherId: Types.ObjectId;
  note: string;
  createdAt: Date;
}

const SyllabusProgressSchema = new Schema<SyllabusProgressDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
    subject: { type: String, enum: SUBJECTS, required: true },
    standard: { type: String, enum: STANDARDS, required: true },
    chapter: { type: String, required: true, trim: true },
    topic: { type: String, default: "", trim: true },
    coveredOn: { type: Date, required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: "", trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A topic counts once per batch, whoever marks it.
SyllabusProgressSchema.index({ batchId: 1, subject: 1, standard: 1, chapter: 1, topic: 1 }, { unique: true });

export default models.SyllabusProgress || model<SyllabusProgressDoc>("SyllabusProgress", SyllabusProgressSchema);
