import type { Types } from "mongoose";
import type { Session } from "@/lib/auth";
import Batch from "@/models/Batch";

/**
 * The batches a user belongs to: every batch for the tuition's own account,
 * the batches a teacher teaches, a student's one batch.
 */
export async function batchIdsOf(session: Session): Promise<Types.ObjectId[] | "all"> {
  if (session.role === "tuition") return "all";
  if (session.role === "student") return session.user.batchId ? [session.user.batchId] : [];
  const batches = await Batch.find({ tuitionId: session.tuitionId, "teachers.teacherId": session.user._id })
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();
  return batches.map((b) => b._id);
}

/** Whether the user may see or act on this batch. */
export async function canUseBatch(session: Session, batchId: string): Promise<boolean> {
  const ids = await batchIdsOf(session);
  if (ids === "all") return !!(await Batch.exists({ _id: batchId, tuitionId: session.tuitionId }));
  return ids.some((id) => String(id) === batchId);
}
