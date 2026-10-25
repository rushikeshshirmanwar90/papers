import { requireUser, type Session } from "@/lib/auth";
import { HttpError, isObjectId, notFound, readJson, route } from "@/lib/http";
import { checkClashes, entriesOut, readEntry } from "@/lib/timetable";
import TimetableEntry, { type TimetableEntryDoc } from "@/models/TimetableEntry";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** The class, if the user may change it: the tuition any, a teacher their own. */
async function editable(session: Session, id: string): Promise<TimetableEntryDoc> {
  if (!isObjectId(id)) throw notFound("This class");
  const entry = (await TimetableEntry.findOne({ _id: id, tuitionId: session.tuitionId })) as TimetableEntryDoc | null;
  if (!entry) throw notFound("This class");
  if (session.role === "teacher" && String(entry.teacherId) !== session.userId) throw new HttpError(403, "You can only change your own classes.");
  return entry;
}

export const PATCH = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const entry = await editable(session, params.id);
  const { fields } = await readEntry(session, await readJson(req), entry);
  await checkClashes(fields, entry._id as never);
  entry.set(fields);
  await entry.save();
  return { entry: (await entriesOut(session, [entry]))[0] };
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const entry = await editable(session, params.id);
  await entry.deleteOne();
  return { ok: true };
});
