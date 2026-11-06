import { Schema, model, models, type Document, type Types } from "mongoose";

/**
 * One question as it was when the test was made: a copy, so later edits to
 * the question bank don't change a test students have already taken.
 */
export interface TestQuestion {
  sourceId: Types.ObjectId | null;
  subject: string;
  standard: string;
  chapter: string;
  topic: string;
  difficulty: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  answerType: string;
  correctAnswer: string;
  explanation: string;
  diagramUrls: string[];
  optionDiagramUrls: { A: string[]; B: string[]; C: string[]; D: string[] };
  explanationDiagramUrls: string[];
}

/**
 * A test a teacher sets for a batch.
 *
 * Times are UTC instants. The window (opensAt to closesAt) is separate from
 * the time limit (durationMinutes) each student gets once they start, so the
 * last moment to start is closesAt minus the time limit. Its status
 * (scheduled, open, closed) isn't stored: see statusOf in lib/tests.ts.
 * Question count and maximum marks follow from `questions` and
 * `marksPerQuestion`, so they aren't stored either.
 */
export interface TestRoomDoc extends Document {
  tuitionId: Types.ObjectId;
  batchIds?: Types.ObjectId[];
  accessVersion?: number;
  audienceMode?: "all" | "selected";
  roster?: { studentId: Types.ObjectId; allowed: boolean; started: boolean; request: "pending" | "approved" | "declined" | null; decidedBy?: Types.ObjectId; decidedAt?: Date }[];
  batchId: Types.ObjectId;
  teacherId: Types.ObjectId;
  title: string;
  subject: string;
  standard: string;
  questions: TestQuestion[];
  marksPerQuestion: number;
  /** Marks taken off for a wrong answer (0 = none). */
  negativeMarks: number;
  durationMinutes: number;
  opensAt: Date;
  /** Closing the test early ("Close now") sets this to that moment. */
  closesAt: Date;
  manuallyEndedAt?: Date | null;
  controlRevision?: number;
  /** Request-local participation data; never persisted. */
  continuationUntil?: Date | null;
  pendingResolution?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const urls = { type: [String], default: [] };

const TestQuestionSchema = new Schema<TestQuestion>(
  {
    sourceId: { type: Schema.Types.ObjectId, ref: "Question", default: null },
    subject: { type: String, default: "" },
    standard: { type: String, default: "" },
    chapter: { type: String, default: "" },
    topic: { type: String, default: "" },
    difficulty: { type: String, default: "" },
    questionText: { type: String, default: "" },
    optionA: { type: String, default: "" },
    optionB: { type: String, default: "" },
    optionC: { type: String, default: "" },
    optionD: { type: String, default: "" },
    answerType: { type: String, default: "MCQ" },
    correctAnswer: { type: String, default: "" },
    explanation: { type: String, default: "" },
    diagramUrls: urls,
    optionDiagramUrls: { A: urls, B: urls, C: urls, D: urls },
    explanationDiagramUrls: urls,
  },
  { _id: false }
);

const TestRoomSchema = new Schema<TestRoomDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    batchIds: { type: [Schema.Types.ObjectId], default: undefined },
    accessVersion: { type: Number },
    audienceMode: { type: String, enum: ['all', 'selected'] },
    roster: { type: [new Schema({ studentId: { type: Schema.Types.ObjectId, required: true }, allowed: Boolean, started: { type: Boolean, default: false }, request: { type: String, enum: ['pending', 'approved', 'declined', null], default: null }, decidedBy: Schema.Types.ObjectId, decidedAt: Date }, { _id: false })], default: undefined },
    title: { type: String, required: true, trim: true },
    subject: { type: String, default: "" },
    standard: { type: String, default: "" },
    questions: { type: [TestQuestionSchema], default: [] },
    marksPerQuestion: { type: Number, default: 4, min: 0, max: 100 },
    negativeMarks: { type: Number, default: 0, min: 0, max: 100 },
    durationMinutes: { type: Number, required: true, min: 1, max: 600 },
    opensAt: { type: Date, required: true },
    closesAt: { type: Date, required: true },
    manuallyEndedAt: { type: Date, default: null },
    controlRevision: { type: Number, default: 0 },
  },
  { timestamps: true }
);

TestRoomSchema.index({ tuitionId: 1, createdAt: -1 });
TestRoomSchema.index({ tuitionId: 1, batchIds: 1, opensAt: -1 });
// Test lists: a tuition's tests (or some batches') by when they open.
TestRoomSchema.index({ tuitionId: 1, batchId: 1, opensAt: -1 });

export default models.TestRoom || model<TestRoomDoc>("TestRoom", TestRoomSchema);
