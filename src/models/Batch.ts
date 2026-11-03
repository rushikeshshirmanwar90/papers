import { Schema, model, models, type Document, type Types } from "mongoose";
import { PROGRAMS, STANDARDS, SUBJECTS, TRACKS, type Program, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";

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
  /** The name trimmed and lower-cased, for the per-tuition unique index. Older batches have none. */
  nameKey?: string;
  /** What the batch prepares for. Older batches have only `track`: see programOf. */
  program?: Program;
  /** The track the program stands for, kept for older app versions. */
  track: Track;
  standard?: SchoolStandard;
  /** e.g. "2026-2027"; older batches have none. */
  academicYear?: string;
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
    nameKey: { type: String },
    program: { type: String, enum: PROGRAMS },
    track: { type: String, enum: TRACKS, required: true },
    standard: { type: String, enum: STANDARDS },
    academicYear: { type: String, match: /^\d{4}-\d{4}$/ },
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

// Batch names are unique within a tuition, ignoring spaces at the ends and case.
// The key is set only when a batch is made or renamed, and the index skips batches
// without one, so older batches (which may share a name) are never touched or blocked.
BatchSchema.pre("save", function () {
  if (this.isNew || this.isModified("name")) this.nameKey = this.name.trim().toLowerCase();
});
BatchSchema.index({ tuitionId: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { nameKey: { $type: "string" } } });

export default models.Batch || model<BatchDoc>("Batch", BatchSchema);
