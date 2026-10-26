import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { isObjectId, readJson, route } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import { announceTimetableChange, checkClashes, entriesOut, readEntry } from "@/lib/timetable";
import TimetableEntry, { type TimetableEntryDoc } from "@/models/TimetableEntry";

export const dynamic = "force-dynamic";

/**
 * The weekly timetable the user should see, by day and time: every class for
 * the tuition, the classes of a teacher's batches, a student's batch.
 * ?batchId= narrows to one batch.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req);
  const ids = await batchIdsOf(session);
  const filter: Record<string, unknown> = { tuitionId: session.tuitionId };
  if (ids !== "all") filter.batchId = { $in: ids };
  const only = req.nextUrl.searchParams.get("batchId");
  if (isObjectId(only)) filter.batchId = ids === "all" || ids.some((id) => String(id) === only) ? new Types.ObjectId(only) : { $in: [] };
  const entries = (await TimetableEntry.find(filter).sort({ day: 1, start: 1 })) as TimetableEntryDoc[];
  return { entries: await entriesOut(session, entries) };
});

/** Adds a weekly class: { batchId, subject, day, start, end, note?, teacherId? (tuition only) }. */
export const POST = route(async (req) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { fields } = await readEntry(session, await readJson(req));
  await checkClashes(fields);
  const entry = (await TimetableEntry.create(fields)) as TimetableEntryDoc;
  await announceTimetableChange(session, entry.batchId, entry.subject);
  return { entry: (await entriesOut(session, [entry]))[0] };
});
