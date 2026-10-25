import mongoose from "mongoose";
import { hashPassword, requireAdminKey } from "@/lib/auth";
import { email, password, readJson, route, text } from "@/lib/http";
import Tuition from "@/models/Tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

// For the Admin web app (not built yet; scripts/create-tuition.mjs stands in):
// every request needs the X-Admin-Key header to match ADMIN_API_KEY.

/** Every tuition, newest first, with its login email and how many people it has. */
export const GET = route(async (req) => {
  requireAdminKey(req);
  const tuitions = await Tuition.find().sort({ createdAt: -1 }).lean();
  const counts = await User.aggregate<{ _id: { t: mongoose.Types.ObjectId; r: string }; n: number }>([
    { $group: { _id: { t: "$tuitionId", r: "$role" }, n: { $sum: 1 } } },
  ]);
  const owners = await User.find({ role: "tuition" }).select("tuitionId email").lean();
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
  requireAdminKey(req);
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
