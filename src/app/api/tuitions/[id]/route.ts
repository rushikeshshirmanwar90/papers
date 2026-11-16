import { isObjectId, notFound, readJson, route, text } from "@/lib/http";
import Batch from "@/models/Batch";
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

/**
 * Edits a tuition's details or toggles it active/inactive:
 * { name?, adminName?, address?, phone?, email?, active? }
 */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const tuition = await find(params.id);
  const body = await readJson(req);

  if (body.name !== undefined) tuition.name = text(body, "name", { required: true, max: 120, label: "the tuition's name" })!;
  if (body.address !== undefined) tuition.address = text(body, "address", { max: 300 }) ?? "";
  if (body.phone !== undefined) tuition.phone = text(body, "phone", { max: 20 }) ?? "";
  if (body.email !== undefined) tuition.email = (text(body, "email", { max: 200 }) ?? "").toLowerCase();
  if (body.active !== undefined) tuition.active = body.active === true;
  await tuition.save();

  if (body.adminName !== undefined) {
    const adminName = text(body, "adminName", { required: true, max: 100, label: "the admin's name" });
    if (adminName) {
      await User.updateOne({ tuitionId: tuition._id, role: "tuition" }, { name: adminName });
    }
  }

  const owner = await User.findOne({ tuitionId: tuition._id, role: "tuition" }).select("name email").lean<{ name: string; email: string }>();
  return {
    tuition: {
      id: String(tuition._id),
      name: tuition.name,
      address: tuition.address,
      phone: tuition.phone,
      email: tuition.email,
      active: tuition.active,
      adminName: owner?.name ?? null,
      loginEmail: owner?.email ?? null,
    },
  };
});

/**
 * Deletes a tuition and all its data: its owner login, teachers, students,
 * batches, tests and test attempts. This is irreversible.
 */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const tuition = await find(params.id);
  const tid = tuition._id;

  // Collect test ids before deleting rooms, so we can drop their attempts.
  const testIds = await TestRoom.find({ tuitionId: tid }).distinct("_id");

  await Promise.all([
    User.deleteMany({ tuitionId: tid }),
    Batch.deleteMany({ tuitionId: tid }),
    TestRoom.deleteMany({ tuitionId: tid }),
    TestAttempt.deleteMany({ testId: { $in: testIds } }),
  ]);

  await Tuition.deleteOne({ _id: tid });

  return { ok: true };
});
