import { Schema, model, models, type Document, type Types } from "mongoose";

/** A student's XP and practice on one IST day: the goal ring, the streak day, later the teacher view and metrics. */
export interface DailyActivityDoc extends Document {
  studentId: Types.ObjectId;
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId | null;
  /** IST 'YYYY-MM-DD'. */
  date: string;
  xp: number;
  /** The part of xp from practice answers (capped per day). */
  practiceXp: number;
  /** Practice answers that were awarded (first tries and fixes). */
  questions: number;
  correct: number;
  mistakesFixed: number;
  /** The goal that applied this day, fixed when the day starts. */
  goalXp: number;
  goalMet: boolean;
  /** An assigned test written this day (exam-day streak protection). */
  testDay: boolean;
  firstAt: Date;
  lastAt: Date;
}

const DailyActivitySchema = new Schema<DailyActivityDoc>({
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
  batchId: { type: Schema.Types.ObjectId, ref: "Batch", default: null },
  date: { type: String, required: true },
  xp: { type: Number, default: 0 },
  practiceXp: { type: Number, default: 0 },
  questions: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  mistakesFixed: { type: Number, default: 0 },
  goalXp: { type: Number, required: true },
  goalMet: { type: Boolean, default: false },
  testDay: { type: Boolean, default: false },
  firstAt: { type: Date, required: true },
  lastAt: { type: Date, required: true },
});

DailyActivitySchema.index({ studentId: 1, date: 1 }, { unique: true });
DailyActivitySchema.index({ batchId: 1, date: 1 });

export default models.DailyActivity || model<DailyActivityDoc>("DailyActivity", DailyActivitySchema);
