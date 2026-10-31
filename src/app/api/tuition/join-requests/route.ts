import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import JoinRequest from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** People waiting to join with the tuition's own code, oldest first. (Batch codes: see /tuition/enrollments.) */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const requests = await JoinRequest.find({ tuitionId, status: "pending", batchId: null })
    .sort({ createdAt: 1 })
    .lean<{ _id: Types.ObjectId; userId: Types.ObjectId; createdAt: Date }[]>();
  const people = await User.find({ _id: { $in: requests.map((r) => r.userId) }, tuitionId: null })
    .select("name email phone")
    .lean<{ _id: Types.ObjectId; name: string; email: string; phone: string }[]>();
  return {
    requests: requests.flatMap((r) => {
      const p = people.find((x) => String(x._id) === String(r.userId));
      return p ? [{ id: String(r._id), createdAt: r.createdAt, person: { name: p.name, email: p.email, phone: p.phone } }] : [];
    }),
  };
});
