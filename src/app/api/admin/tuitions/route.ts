import mongoose from "mongoose";
import { requireAdmin } from "@/lib/admin";
import { hashPassword } from "@/lib/auth";
import { email, password, readJson, route, text } from "@/lib/http";
import Batch from "@/models/Batch";
import Tuition from "@/models/Tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

// For the admin console (session cookie) and scripts/create-tuition.mjs
// (X-Admin-Key header matching ADMIN_API_KEY).

/** Every tuition, newest first, with its login email and how many people it has. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 60);
  const filter = q ? { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } : {};
  const tuitions = await Tuition.find(filter).sort({ createdAt: -1 }).lean();
  const counts = await User.aggregate<{ _id: { t: mongoose.Types.ObjectId; r: string }; n: number }>([
    { $group: { _id: { t: "$tuitionId", r: "$role" }, n: { $sum: 1 } } },
  ]);
  const owners = await User.find({ role: "tuition" }).select("tuitionId email").lean();
  const batchCounts = await Batch.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([{ $group: { _id: "$tuitionId", n: { $sum: 1 } } }]);
  return {
    tuitions: tuitions.map((t) => {
      const count = (role: string) => counts.find((c) => String(c._id.t) === String(t._id) && c._id.r === role)?.n ?? 0;
      return {
        id: String(t._id),
        name: t.name,
        address: t.address,
        phone: t.phone,
        email: t.email,
        active: t.active,
        loginEmail: owners.find((o) => String(o.tuitionId) === String(t._id))?.email ?? null,
        teachers: count("teacher"),
        students: count("student"),
        batches: batchCounts.find((b) => String(b._id) === String(t._id))?.n ?? 0,
        createdAt: t.createdAt,
      };
    }),
  };
});

/**
 * Creates a tuition and the account it logs in with:
 * { name, address?, phone?, loginEmail, password }
 */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const body = await readJson(req);
  const name = text(body, "name", { required: true, max: 120, label: "the tuition's name" })!;
  const loginEmail = email(body, "loginEmail");
  const pass = password(body);

  const tuition = await Tuition.create({
    name,
    address: text(body, "address", { max: 300 }) ?? "",
    phone: text(body, "phone", { max: 20 }) ?? "",
    email: loginEmail,
  });
  try {
    const owner = await User.create({
      email: loginEmail,
      passwordHash: await hashPassword(pass),
      role: "tuition",
      name,
      phone: tuition.phone,
      tuitionId: tuition._id,
    });
    return { tuition: { id: String(tuition._id), name }, login: { email: owner.email } };
  } catch (error) {
    // The email was taken: don't leave a tuition nobody can log in to.
    await Tuition.deleteOne({ _id: tuition._id });
    throw error;
  }
});
