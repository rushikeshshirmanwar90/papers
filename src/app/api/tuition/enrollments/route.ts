import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { programOf } from "@/lib/school";
import { route } from "@/lib/http";
import JoinRequest, { type JoinSource } from "@/models/JoinRequest";
import Batch, { type BatchDoc } from "@/models/Batch";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type BatchOut = { id: string; name: string; program: ReturnType<typeof programOf>; standard: string | null };
type EnrollmentOut = { id: string; createdAt: Date; source: JoinSource; name: string; email: string | null; phone: string | null; batch: BatchOut | null };

/**
 * Student enrollment requests waiting for a decision, oldest first:
 * - join-code requests (student used a batch code, no tuitionId yet)
 * - admin-created enrollment-approval requests (student already in tuition, batch set)
 * - admin-created batch-assignment requests (student in tuition, no batch yet)
 */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const requests = await JoinRequest.find({ tuitionId, status: "pending", role: "student" })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean<{ _id: Types.ObjectId; userId: Types.ObjectId; batchId: Types.ObjectId | null; source?: JoinSource; createdAt: Date }[]>();

  const userIds = requests.map((r) => r.userId);
  const batchIds = requests.filter((r) => r.batchId).map((r) => r.batchId!);
  const [people, batches] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("name email phone tuitionId").lean<{ _id: Types.ObjectId; name: string; email: string; phone: string; tuitionId: Types.ObjectId | null }[]>(),
    Batch.find({ _id: { $in: batchIds }, tuitionId }).select("name program track standard").lean<Pick<BatchDoc, "_id" | "name" | "program" | "track" | "standard">[]>(),
  ]);

  return {
    enrollments: requests.flatMap((r): EnrollmentOut[] => {
      const person = people.find((p) => String(p._id) === String(r.userId));
      if (!person) return [];
      const source: JoinSource = r.source ?? "join_code";
      if (source === "join_code") {
        if (person.tuitionId) return [];
        const batch = r.batchId ? batches.find((b) => String(b._id) === String(r.batchId)) : null;
        if (!batch) return [];
        return [{ id: String(r._id), createdAt: r.createdAt, source, name: person.name, email: null, phone: null, batch: { id: String(batch._id), name: batch.name, program: programOf(batch), standard: batch.standard ?? null } }];
      }
      const batch = r.batchId ? batches.find((b) => String(b._id) === String(r.batchId)) : null;
      return [{
        id: String(r._id),
        createdAt: r.createdAt,
        source,
        name: person.name,
        email: person.email,
        phone: person.phone || null,
        batch: batch ? { id: String(batch._id), name: batch.name, program: programOf(batch), standard: batch.standard ?? null } : null,
      }];
    }),
  };
});
