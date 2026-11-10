import { Schema, model, models, type Document, type Types } from "mongoose";
import type { StreakState } from "@/lib/engagement/streak";

/** One per student: totals, level, goal and streak, for a fast Home read. Written only by lib/engagement. */
export interface StudentEngagementDoc extends Document {
  studentId: Types.ObjectId;
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId | null;
  totalXp: number;
  level: number;
  /** chill | regular | serious | beast. Everyone starts on regular. */
  goal: string;
  streak: StreakState;
  /** Speed guard: when the last practice answer arrived, and how many fast ones in a row. */
  lastAnswerAt: Date | null;
  fastRun: number;
  createdAt: Date;
  updatedAt: Date;
}

const StudentEngagementSchema = new Schema<StudentEngagementDoc>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", default: null },
    totalXp: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 1 },
    goal: { type: String, enum: ["chill", "regular", "serious", "beast"], default: "regular" },
    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      lastGoalDate: { type: String, default: null },
      freezes: { type: Number, default: 0 },
    },
    lastAnswerAt: { type: Date, default: null },
    fastRun: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default models.StudentEngagement || model<StudentEngagementDoc>("StudentEngagement", StudentEngagementSchema);
