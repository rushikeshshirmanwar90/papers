import { Schema, model, models, type Document, type Types } from "mongoose";

/** A student's answer to one question of a test (by its place in the test). */
export interface TestAnswer {
  index: number;
  /** "A"–"D", a number for numerical questions, or null when skipped. */
  selected: string | null;
  /** Set when the attempt is submitted; null for a skipped or unmarked question. */
  correct: boolean | null;
}

/** Something that happened to the app during the attempt, reported by the student's phone. */
export interface TestAttemptEvent {
  type: "away";
  at: Date;
  /** How long the app was out of the foreground, as measured by the phone. */
  awayMs: number;
  /** True when the server judged this long enough to end the attempt. */
  ended: boolean;
  interruptionId?: string;
  reason?: string;
  startedAt?: Date;
  returnedAt?: Date | null;
}

export interface AttemptVisibility {
  clientId: string;
  sequence: number;
  lastSeenAt: Date;
  retiredClients: string[];
  interruption?: { id: string; reason: string; startedAt: Date } | null;
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
  /** Counts answer saves, so scoring can tell whether an answer arrived while it was reading them (see finalize in lib/attempts.ts). */
  rev: number;
  /** Why the attempt ended early, when it did: "violation" = the app was left for longer than allowed. null otherwise. */
  endedReason: "violation" | null;
  /** The last few interruptions reported during the attempt (see recordEvent in lib/attempts.ts). */
  events: TestAttemptEvent[];
  individualDeadline?: Date | null;
  suspendedAt?: Date | null;
  remainingMs?: number;
  resumeVersion?: number;
  visibility?: AttemptVisibility | null;
  controls?: { requestId: string; action: string; teacherId: Types.ObjectId; at: Date; minutes: number; oldDeadline: Date; newDeadline: Date }[];
}

const TestAnswerSchema = new Schema<TestAnswer>(
  {
    index: { type: Number, required: true },
    selected: { type: String, default: null },
    correct: { type: Boolean, default: null },
  },
  { _id: false }
);

const TestAttemptEventSchema = new Schema<TestAttemptEvent>(
  {
    type: { type: String, enum: ["away"], required: true },
    at: { type: Date, required: true },
    awayMs: { type: Number, required: true },
    ended: { type: Boolean, default: false },
    interruptionId: String,
    reason: String,
    startedAt: Date,
    returnedAt: Date,
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
  rev: { type: Number, default: 0 },
  endedReason: { type: String, enum: ["violation", null], default: null },
  events: { type: [TestAttemptEventSchema], default: [] },
  individualDeadline: { type: Date, default: null },
  suspendedAt: { type: Date, default: null },
  remainingMs: { type: Number, default: 0 },
  resumeVersion: { type: Number, default: 0 },
  visibility: { type: new Schema<AttemptVisibility>({
    clientId: String, sequence: Number, lastSeenAt: Date, retiredClients: [String],
    interruption: { type: new Schema({ id: String, reason: String, startedAt: Date }, { _id: false }), default: null },
  }, { _id: false }), default: null },
  controls: { type: [{ _id: false, requestId: String, action: String, teacherId: Schema.Types.ObjectId, at: Date, minutes: Number, oldDeadline: Date, newDeadline: Date }], default: [] },
});

// One attempt per student per test.
TestAttemptSchema.index({ testId: 1, studentId: 1 }, { unique: true });

export default models.TestAttempt || model<TestAttemptDoc>("TestAttempt", TestAttemptSchema);
