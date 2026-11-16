import mongoose from "mongoose";
import { hashPassword } from "@/lib/auth";
import { email, password, readJson, route, text } from "@/lib/http";
import Batch from "@/models/Batch";
import Tuition from "@/models/Tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** All tuitions, newest first, with their member counts. Optionally filtered by ?q=. */
export const GET = route(async (req) => {
  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 60);
  const filter = q ? { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } : {};

  const tuitions = await Tuition.find(filter).sort({ createdAt: -1 }).lean();

  const [counts, owners, batchCounts] = await Promise.all([
    User.aggregate<{ _id: { t: mongoose.Types.ObjectId; r: string }; n: number }>([
      { $group: { _id: { t: "$tuitionId", r: "$role" }, n: { $sum: 1 } } },
    ]),
    User.find({ role: "tuition" }).select("tuitionId email name").lean<{ _id: mongoose.Types.ObjectId; tuitionId: mongoose.Types.ObjectId; email: string; name: string }[]>(),
    Batch.aggregate<{ _id: mongoose.Types.ObjectId; n: number }>([{ $group: { _id: "$tuitionId", n: { $sum: 1 } } }]),
  ]);

  return {
    tuitions: tuitions.map((t) => {
      const count = (role: string) => counts.find((c) => String(c._id.t) === String(t._id) && c._id.r === role)?.n ?? 0;
      const owner = owners.find((o) => String(o.tuitionId) === String(t._id));
      return {
        id: String(t._id),
        name: t.name,
        address: t.address,
        phone: t.phone,
        email: t.email,
        active: t.active,
        loginEmail: owner?.email ?? null,
        adminName: owner?.name ?? null,
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
 * { name, adminName, address?, phone?, loginEmail, password }
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const name = text(body, "name", { required: true, max: 120, label: "the tuition's name" })!;
  const adminName = text(body, "adminName", { max: 100, label: "the admin's name" }) ?? name;
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
      emailVerified: true,
      name: adminName,
      phone: tuition.phone,
      tuitionId: tuition._id,
    });
    return { tuition: { id: String(tuition._id), name }, login: { email: owner.email } };
  } catch (error) {
    // Email already taken — don't leave an ownerless tuition.
    await Tuition.deleteOne({ _id: tuition._id });
    throw error;
  }
});
