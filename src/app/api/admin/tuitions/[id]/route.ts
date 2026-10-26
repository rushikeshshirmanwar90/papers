import { Types } from "mongoose";
import { requireAdmin } from "@/lib/admin";
import { isObjectId, notFound, readJson, route, text } from "@/lib/http";
import { weeklyMinutes } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";
import TestAttempt from "@/models/TestAttempt";
import TestRoom from "@/models/TestRoom";
import Tuition, { type TuitionDoc } from "@/models/Tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

async function find(id: string) {
  if (!isObjectId(id)) throw notFound("This tuition");
  const tuition = (await Tuition.findById(id)) as TuitionDoc | null;
  if (!tuition) throw notFound("This tuition");
  return tuition;
}

/** Everything about one tuition: its login, batches, teachers, students and tests. */
export const GET = route<Ctx>(async (req, { params }) => {
  await requireAdmin(req);
  const tuition = await find(params.id);
  const tid = tuition._id as Types.ObjectId;
  const [owner, people, batches, tests] = await Promise.all([
    User.findOne({ tuitionId: tid, role: "tuition" }).select("email lastLoginAt").lean<{ _id: Types.ObjectId; email: string; lastLoginAt: Date | null }>(),
    User.find({ tuitionId: tid, role: { $in: ["teacher", "student"] } })
      .select("name email phone role active lastLoginAt track standard batchId subjects createdAt")
      .sort({ name: 1 })
      .lean<{ _id: Types.ObjectId; name: string; email: string; phone: string; role: string; active: boolean; lastLoginAt: Date | null; track?: string; standard?: string; batchId?: Types.ObjectId | null; subjects: string[]; createdAt: Date }[]>(),
    Batch.find({ tuitionId: tid }).sort({ name: 1 }) as Promise<BatchDoc[]>,
    TestRoom.find({ tuitionId: tid }).select("title batchId questions opensAt closesAt createdAt").sort({ createdAt: -1 }).limit(50).lean<{ _id: Types.ObjectId; title: string; batchId: Types.ObjectId; questions: unknown[]; opensAt: Date; closesAt: Date | null; createdAt: Date }[]>(),
  ]);
  const submitted = await TestAttempt.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { testId: { $in: tests.map((t) => t._id) }, submittedAt: { $ne: null } } },
    { $group: { _id: "$testId", n: { $sum: 1 } } },
  ]);
  const batchName = (id?: Types.ObjectId | null) => (id ? batches.find((b) => String(b._id) === String(id))?.name ?? null : null);
  const teacherName = (id: Types.ObjectId) => people.find((p) => String(p._id) === String(id))?.name ?? "Removed teacher";

  return {
    tuition: { id: String(tid), name: tuition.name, address: tuition.address, phone: tuition.phone, email: tuition.email, active: tuition.active, createdAt: tuition.createdAt },
    login: owner ? { userId: String(owner._id), email: owner.email, lastLoginAt: owner.lastLoginAt } : null,
    batches: batches.map((b) => ({
      id: String(b._id),
      name: b.name,
      track: b.track,
      standard: b.standard ?? null,
      subjects: b.subjects,
      venue: b.venue,
      weeklyMinutes: weeklyMinutes(b.schedule),
      teachers: b.teachers.map((t) => `${teacherName(t.teacherId)} (${t.subject})`),
      students: people.filter((p) => p.role === "student" && String(p.batchId) === String(b._id)).length,
    })),
    teachers: people.filter((p) => p.role === "teacher").map((p) => ({ id: String(p._id), name: p.name, email: p.email, phone: p.phone, active: p.active, lastLoginAt: p.lastLoginAt, subjects: p.subjects })),
    students: people.filter((p) => p.role === "student").map((p) => ({ id: String(p._id), name: p.name, email: p.email, phone: p.phone, active: p.active, lastLoginAt: p.lastLoginAt, track: p.track ?? null, standard: p.standard ?? null, batch: batchName(p.batchId) })),
    tests: tests.map((t) => ({
      id: String(t._id),
      title: t.title,
      batch: batchName(t.batchId),
      questions: t.questions.length,
      opensAt: t.opensAt,
      closesAt: t.closesAt,
      submitted: submitted.find((s) => String(s._id) === String(t._id))?.n ?? 0,
    })),
  };
});

/**
 * Edits the tuition, or turns it off/on: { name?, address?, phone?, email?, active? }.
 * Turned off, nobody in it can log in or use the app.
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  await requireAdmin(req);
  const tuition = await find(params.id);
  const body = await readJson(req);
  if (body.name !== undefined) tuition.name = text(body, "name", { required: true, max: 120, label: "the tuition's name" })!;
  if (body.address !== undefined) tuition.address = text(body, "address", { max: 300 }) ?? "";
  if (body.phone !== undefined) tuition.phone = text(body, "phone", { max: 20 }) ?? "";
  if (body.email !== undefined) tuition.email = (text(body, "email", { max: 200 }) ?? "").toLowerCase();
  if (body.active !== undefined) tuition.active = body.active === true;
  await tuition.save();
  // Its own login carries the tuition's name.
  if (body.name !== undefined) await User.updateOne({ tuitionId: tuition._id, role: "tuition" }, { name: tuition.name });
  return { tuition: { id: String(tuition._id), name: tuition.name, address: tuition.address, phone: tuition.phone, email: tuition.email, active: tuition.active } };
});
