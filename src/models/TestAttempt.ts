import { Schema, model, models, type Document, type Types } from "mongoose";

/** A student's answer to one question of a test (by its place in the test). */
export interface TestAnswer {
  index: number;
  /** "A"–"D", a number for numerical questions, or null when skipped. */
  selected: string | null;
  /** Set when the attempt is submitted; null for a skipped or unmarked question. */
  correct: boolean | null;
}

/** A student's go at a test: started when they open it, scored when they submit. */
export interface TestAttemptDoc extends Document {
  tuitionId: Types.ObjectId;
  testId: Types.ObjectId;
  batchId: Types.ObjectId;
  studentId: Types.ObjectId;
  answers: TestAnswer[];
  score: number;
  maxScore: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  startedAt: Date;
  /** null while the student is still answering. */
  submittedAt: Date | null;
  timeTakenSeconds: number;
}

const TestAnswerSchema = new Schema<TestAnswer>(
  {
    index: { type: Number, required: true },
    selected: { type: String, default: null },
    correct: { type: Boolean, default: null },
  },
  { _id: false }
);

const TestAttemptSchema = new Schema<TestAttemptDoc>({
  tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
  testId: { type: Schema.Types.ObjectId, ref: "TestRoom", required: true },
  batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  answers: { type: [TestAnswerSchema], default: [] },
  score: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  wrongCount: { type: Number, default: 0 },
  skippedCount: { type: Number, default: 0 },
  startedAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null },
  timeTakenSeconds: { type: Number, default: 0 },
});

// One attempt per student per test.
TestAttemptSchema.index({ testId: 1, studentId: 1 }, { unique: true });

export default models.TestAttempt || model<TestAttemptDoc>("TestAttempt", TestAttemptSchema);
