import { Schema, model, models, type Document, type Types } from "mongoose";
import type { TestQuestion } from "@/models/TestRoom";
import type { TestAnswer } from "@/models/TestAttempt";

/** A chapter the student picked, with the topics picked (none: the whole chapter). */
export interface AssessmentScope {
  standard: string;
  chapter: string;
  topics: string[];
}

/**
 * A test a student makes for themselves from past-year questions: they pick
 * chapters and topics, lib/assessment-pick.ts chooses the questions. Questions
 * are copied (like a teacher's test) so the result stays as it was taken.
 */
export interface SelfAssessmentDoc extends Document {
  tuitionId: Types.ObjectId;
  studentId: Types.ObjectId;
  subject: string;
  title: string;
  scope: AssessmentScope[];
  /** smart | balanced | challenge | retake */
  mix: string;
  /** The split the questions were chosen for, e.g. { Easy: 6, Medium: 10, Hard: 4 }. */
  plan: { Easy: number; Medium: number; Hard: number; fresh: number; requested: number };
  /** Why Smart chose its split: the student's accuracy in these topics before. */
  basis: { kind: string; accuracy: number | null; answered: number };
  questions: TestQuestion[];
  marksPerQuestion: number;
  negativeMarks: number;
  /** null: no time limit. */
  durationMinutes: number | null;
  /** null until the student taps Start. */
  startedAt: Date | null;
  submittedAt: Date | null;
  answers: TestAnswer[];
  score: number;
  maxScore: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  timeTakenSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

const urls = { type: [String], default: [] };

const QuestionCopySchema = new Schema<TestQuestion>(
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

const AnswerSchema = new Schema<TestAnswer>(
  {
    index: { type: Number, required: true },
    selected: { type: String, default: null },
    correct: { type: Boolean, default: null },
  },
  { _id: false }
);

const SelfAssessmentSchema = new Schema<SelfAssessmentDoc>(
  {
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    scope: {
      type: [new Schema<AssessmentScope>({ standard: String, chapter: String, topics: { type: [String], default: [] } }, { _id: false })],
      default: [],
    },
    mix: { type: String, default: "balanced" },
    plan: {
      Easy: { type: Number, default: 0 },
      Medium: { type: Number, default: 0 },
      Hard: { type: Number, default: 0 },
      fresh: { type: Number, default: 0 },
      requested: { type: Number, default: 0 },
    },
    basis: {
      kind: { type: String, default: "fixed" },
      accuracy: { type: Number, default: null },
      answered: { type: Number, default: 0 },
    },
    questions: { type: [QuestionCopySchema], default: [] },
    marksPerQuestion: { type: Number, default: 4 },
    negativeMarks: { type: Number, default: 1 },
    durationMinutes: { type: Number, default: null, min: 1, max: 600 },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    answers: { type: [AnswerSchema], default: [] },
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    timeTakenSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// A student's own list, newest first.
SelfAssessmentSchema.index({ studentId: 1, createdAt: -1 });

export default models.SelfAssessment || model<SelfAssessmentDoc>("SelfAssessment", SelfAssessmentSchema);
