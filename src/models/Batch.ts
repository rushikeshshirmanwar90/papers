import { Schema, model, models, type Document, type Types } from "mongoose";
import { STANDARDS, SUBJECTS, TRACKS, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";

/** One weekly class slot, e.g. Monday 16:00–18:00. */
export interface BatchSlot {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  /** "HH:MM", 24-hour */
  start: string;
  end: string;
}

/** Who teaches which subject to the batch. */
export interface BatchTeacher {
  teacherId: Types.ObjectId;
  subject: SchoolSubject;
}

/** A group of a tuition's students taught together, at set times. */
export interface BatchDoc extends Document {
  tuitionId: Types.ObjectId;
  name: string;
  track: Track;
  standard?: SchoolStandard;
  subjects: SchoolSubject[];
  venue: string;
  schedule: BatchSlot[];
  teachers: BatchTeacher[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const BatchSchema = new Schema<BatchDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true, index: true },
    name: { type: String, required: true, trim: true },
    track: { type: String, enum: TRACKS, required: true },
    standard: { type: String, enum: STANDARDS },
    subjects: { type: [{ type: String, enum: SUBJECTS }], default: [] },
    venue: { type: String, default: "", trim: true },
    schedule: {
      type: [
        {
          _id: false,
          day: { type: Number, min: 0, max: 6, required: true },
          start: { type: String, match: TIME, required: true },
          end: { type: String, match: TIME, required: true },
        },
      ],
      default: [],
    },
    teachers: {
      type: [
        {
          _id: false,
          teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          subject: { type: String, enum: SUBJECTS, required: true },
        },
      ],
      default: [],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

BatchSchema.index({ "teachers.teacherId": 1 });

export default models.Batch || model<BatchDoc>("Batch", BatchSchema);
