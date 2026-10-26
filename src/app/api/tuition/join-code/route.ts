import { requireUser } from "@/lib/auth";
import { notFound, route } from "@/lib/http";
import { formatCode, joinCodeOf, renewJoinCode } from "@/lib/join-code";
import Tuition, { type TuitionDoc } from "@/models/Tuition";

export const dynamic = "force-dynamic";

async function mine(tuitionId: string) {
  const tuition = (await Tuition.findById(tuitionId)) as TuitionDoc | null;
  if (!tuition) throw notFound("This tuition");
  return tuition;
}

/** The code teachers sign up with. */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  return { code: formatCode(await joinCodeOf(await mine(tuitionId))) };
});

/** A new code; the old one stops working (e.g. if it was shared too widely). */
export const POST = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  return { code: formatCode(await renewJoinCode(await mine(tuitionId))) };
});
