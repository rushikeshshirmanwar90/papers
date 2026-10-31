import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { isObjectId, readJson, route } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import { announceTimetableChange, checkClashes, entriesOut, readEntries } from "@/lib/timetable";
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

/**
 * Adds a weekly class, or the same class on several days:
 * { batchId, subject, day | days: [1, 3, 5], start, end, note?, teacherId? | null (tuition only) }.
 * All or none: when one day overlaps another class of the batch or of the
 * teacher, nothing is added.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { entries: fields } = await readEntries(session, await readJson(req));
  await checkClashes(fields);
  const created = (await TimetableEntry.insertMany(fields)) as unknown as TimetableEntryDoc[];
  await announceTimetableChange(session, created[0].batchId, created[0].subject);
  const entries = await entriesOut(session, created);
  return { entry: entries[0], entries };
});
