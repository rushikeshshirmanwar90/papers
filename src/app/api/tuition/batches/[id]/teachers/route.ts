import { requireUser } from "@/lib/auth";
import { badRequest, listOf, readJson, route } from "@/lib/http";
import { SUBJECTS } from "@/lib/school";
import { EMPTY_SUMMARY, timetableSummaries } from "@/lib/timetable";
import { assignTeacher, batchOut, findBatch, teacherNames } from "@/lib/tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

async function out(tuitionId: string, batch: Awaited<ReturnType<typeof findBatch>>) {
  const [names, count, classes] = await Promise.all([
    teacherNames(tuitionId),
    User.countDocuments({ tuitionId, role: "student", batchId: batch._id }),
    timetableSummaries(tuitionId, [batch._id as never]),
  ]);
  return { batch: batchOut(batch, names, count, classes.get(String(batch._id)) ?? EMPTY_SUMMARY) };
}

/**
 * Assigns a teacher of this tuition to the batch, or changes their subjects there:
 * { teacherId, subjects: [...] } (at least one, all of them the batch's).
 */
export const PUT = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  const body = await readJson(req);
  const subjects = listOf(body, "subjects", SUBJECTS, "Subjects");
  if (!subjects.length) throw badRequest("Pick at least one subject.");
  await assignTeacher(batch, String(body.teacherId), subjects);
  return out(tuitionId, batch);
});

/** Removes the teacher from this batch only (?teacherId=); their account and other batches stay. */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const batch = await findBatch(tuitionId, params.id);
  await assignTeacher(batch, String(req.nextUrl.searchParams.get("teacherId")), []);
  return out(tuitionId, batch);
});
