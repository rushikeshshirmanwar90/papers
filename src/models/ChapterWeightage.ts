import { Schema, model, models, type Document, type Types } from "mongoose";
import { STANDARDS, SUBJECTS, TRACKS, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";

/** How many marks a chapter usually carries in the exam, as the tuition sets it. */
export interface ChapterWeightageDoc extends Document {
  tuitionId: Types.ObjectId;
  track: Track;
  subject: SchoolSubject;
  standard: SchoolStandard;
  chapter: string;
  marks: number;
}

const ChapterWeightageSchema = new Schema<ChapterWeightageDoc>({
  tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
  track: { type: String, enum: TRACKS, required: true },
  subject: { type: String, enum: SUBJECTS, required: true },
  standard: { type: String, enum: STANDARDS, required: true },
  chapter: { type: String, required: true, trim: true },
  marks: { type: Number, min: 0, max: 1000, required: true },
});

ChapterWeightageSchema.index({ tuitionId: 1, track: 1, subject: 1, standard: 1, chapter: 1 }, { unique: true });

export default models.ChapterWeightage || model<ChapterWeightageDoc>("ChapterWeightage", ChapterWeightageSchema);
