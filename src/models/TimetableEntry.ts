import { Schema, model, models, type Document, type Types } from "mongoose";
import { SUBJECTS, type SchoolSubject } from "@/lib/school";

/** A weekly class: which teacher teaches which subject to a batch, and when. */
export interface TimetableEntryDoc extends Document {
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId;
  teacherId: Types.ObjectId;
  subject: SchoolSubject;
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  start: string;
  end: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const TimetableEntrySchema = new Schema<TimetableEntryDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true, index: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    subject: { type: String, enum: SUBJECTS, required: true },
    day: { type: Number, min: 0, max: 6, required: true },
    start: { type: String, match: TIME, required: true },
    end: { type: String, match: TIME, required: true },
    note: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

export default models.TimetableEntry || model<TimetableEntryDoc>("TimetableEntry", TimetableEntrySchema);
