import { requireUser } from "@/lib/auth";
import { notFound, readJson, route, text } from "@/lib/http";
import Tuition from "@/models/Tuition";

export const dynamic = "force-dynamic";

const out = (t: { name: string; address: string; phone: string; email: string }) => ({
  name: t.name,
  address: t.address,
  phone: t.phone,
  email: t.email,
});

/** The tuition's own details. Teachers and students may read them too. */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req);
  const tuition = await Tuition.findById(tuitionId).lean<{ name: string; address: string; phone: string; email: string }>();
  if (!tuition) throw notFound("This tuition");
  return { tuition: out(tuition) };
});

/** The tuition edits its name, address and contact details. */
export const PATCH = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const changes: Record<string, string> = {};
  if (body.name !== undefined) changes.name = text(body, "name", { required: true, max: 120, label: "the tuition's name" })!;
  if (body.address !== undefined) changes.address = text(body, "address", { max: 300 }) ?? "";
  if (body.phone !== undefined) changes.phone = text(body, "phone", { max: 20 }) ?? "";
  if (body.email !== undefined) changes.email = (text(body, "email", { max: 200 }) ?? "").toLowerCase();
  const tuition = await Tuition.findByIdAndUpdate(tuitionId, changes, { returnDocument: "after", runValidators: true }).lean<{
    name: string;
    address: string;
    phone: string;
    email: string;
  }>();
  if (!tuition) throw notFound("This tuition");
  return { tuition: out(tuition) };
});
