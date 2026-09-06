import { Schema, model, models, Types, type Document } from "mongoose";

export interface GivenAnswerDoc {
  questionId: Types.ObjectId;
  selected: string | null;
}

export interface AttemptDoc extends Document {
  studentId: Types.ObjectId;
  paperId: Types.ObjectId;
  answers: GivenAnswerDoc[];
  score: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  totalQuestions: number;
  timeTaken: number;
  attemptedDate: Date;
}

const GivenAnswerSchema = new Schema<GivenAnswerDoc>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    selected: { type: String, default: null },
  },
  { _id: false }
);

const AttemptSchema = new Schema<AttemptDoc>({
  studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
  paperId: { type: Schema.Types.ObjectId, ref: "Paper", required: true, index: true },
  answers: [GivenAnswerSchema],
  score: { type: Number, required: true },
  correctCount: { type: Number, required: true },
  wrongCount: { type: Number, required: true },
  skippedCount: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  timeTaken: { type: Number, default: 0 },
  attemptedDate: { type: Date, default: Date.now },
});

export default models.Attempt || model<AttemptDoc>("Attempt", AttemptSchema);
