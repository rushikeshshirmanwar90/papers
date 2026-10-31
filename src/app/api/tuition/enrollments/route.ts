import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { programOf } from "@/lib/school";
import { route } from "@/lib/http";
import JoinRequest from "@/models/JoinRequest";
import Batch, { type BatchDoc } from "@/models/Batch";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Students who asked to join a batch with its joining code and wait for a
 * decision, oldest first. Names only: they have no email or phone to show
 * until they're approved. Tuition accounts only, and only their own tuition.
 */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const requests = await JoinRequest.find({ tuitionId, status: "pending", batchId: { $ne: null } })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean<{ _id: Types.ObjectId; userId: Types.ObjectId; batchId: Types.ObjectId; createdAt: Date }[]>();
  const [people, batches] = await Promise.all([
    User.find({ _id: { $in: requests.map((r) => r.userId) }, tuitionId: null }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
    Batch.find({ _id: { $in: requests.map((r) => r.batchId) }, tuitionId }).select("name program track standard").lean<Pick<BatchDoc, "_id" | "name" | "program" | "track" | "standard">[]>(),
  ]);
  return {
    enrollments: requests.flatMap((r) => {
      const person = people.find((p) => String(p._id) === String(r.userId));
      const batch = batches.find((b) => String(b._id) === String(r.batchId));
      return person && batch
        ? [{ id: String(r._id), createdAt: r.createdAt, name: person.name, batch: { id: String(batch._id), name: batch.name, program: programOf(batch), standard: batch.standard ?? null } }]
        : [];
    }),
  };
});
