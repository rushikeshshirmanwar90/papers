import { Schema, model, models, type Document, type Types } from "mongoose";

/** A student's latest answer to a practice (PYQ) question, for weak and strong topics. */
export interface PracticeAnswerDoc extends Document {
  tuitionId: Types.ObjectId;
  studentId: Types.ObjectId;
  questionId: Types.ObjectId;
  subject: string;
  standard: string;
  chapter: string;
  topic: string;
  selected: string;
  correct: boolean;
  answeredAt: Date;
}

const PracticeAnswerSchema = new Schema<PracticeAnswerDoc>({
  tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
  subject: { type: String, default: "" },
  standard: { type: String, default: "" },
  chapter: { type: String, default: "" },
  topic: { type: String, default: "" },
  selected: { type: String, required: true },
  correct: { type: Boolean, required: true },
  answeredAt: { type: Date, required: true },
});

PracticeAnswerSchema.index({ studentId: 1, questionId: 1 }, { unique: true });

export default models.PracticeAnswer || model<PracticeAnswerDoc>("PracticeAnswer", PracticeAnswerSchema);
