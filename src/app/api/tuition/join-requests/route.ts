import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import JoinRequest from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** Teachers waiting to join with the institute's teacher code, oldest first. (Students' batch codes: see /tuition/enrollments.) */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const requests = await JoinRequest.find({ tuitionId, status: "pending", role: "teacher" })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean<{ _id: Types.ObjectId; userId: Types.ObjectId; subjects: string[]; createdAt: Date }[]>();
  const people = await User.find({ _id: { $in: requests.map((r) => r.userId) }, tuitionId: null })
    .select("name email emailVerified")
    .lean<{ _id: Types.ObjectId; name: string; email: string; emailVerified: boolean }[]>();
  return {
    requests: requests.flatMap((r) => {
      const p = people.find((x) => String(x._id) === String(r.userId));
      return p ? [{ id: String(r._id), createdAt: r.createdAt, subjects: r.subjects ?? [], person: { name: p.name, email: p.email, emailVerified: !!p.emailVerified } }] : [];
    }),
  };
});
