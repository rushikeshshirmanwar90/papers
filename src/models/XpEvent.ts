import { Schema, model, models, type Document, type Types } from "mongoose";

/**
 * The append-only XP ledger: one entry per award, written only by
 * lib/engagement/award.ts. `key` makes every award idempotent (retries,
 * double taps and replays award once). The truth for XP, the weekly league,
 * challenges and metrics.
 */
export interface XpEventDoc extends Document {
  key: string;
  studentId: Types.ObjectId;
  tuitionId: Types.ObjectId;
  batchId: Types.ObjectId | null;
  /** 'practice.correct' | 'practice.wrong' | 'mistake.fixed' | 'self.submitted' | 'test.submitted' */
  kind: string;
  /** After caps and guards; may be 0 (still recorded). */
  xp: number;
  /** IST 'YYYY-MM-DD'. */
  date: string;
  /** IST ISO week, e.g. '2026-W46'. */
  weekKey: string;
  /** false for late-night XP (00:00–05:00 IST): it counts, but not toward the league. */
  league: boolean;
  /** Counts toward the daily practice cap. */
  practice: boolean;
  meta: Record<string, unknown>;
  at: Date;
}

const XpEventSchema = new Schema<XpEventDoc>({
  key: { type: String, required: true, unique: true },
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true },
  batchId: { type: Schema.Types.ObjectId, ref: "Batch", default: null },
  kind: { type: String, required: true },
  xp: { type: Number, required: true },
  date: { type: String, required: true },
  weekKey: { type: String, required: true },
  league: { type: Boolean, default: true },
  practice: { type: Boolean, default: false },
  meta: { type: Schema.Types.Mixed, default: {} },
  at: { type: Date, required: true },
});

XpEventSchema.index({ studentId: 1, date: 1 });
XpEventSchema.index({ batchId: 1, weekKey: 1, league: 1 });

export default models.XpEvent || model<XpEventDoc>("XpEvent", XpEventSchema);
