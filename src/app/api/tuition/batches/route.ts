import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { batchOut, readBatch, studentCounts, teacherNames } from "@/lib/tuition";
import Batch, { type BatchDoc } from "@/models/Batch";

export const dynamic = "force-dynamic";

/** The tuition's batches, by name, with their teachers and student counts. */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const [batches, counts, names] = await Promise.all([
    Batch.find({ tuitionId }).sort({ name: 1 }) as Promise<BatchDoc[]>,
    studentCounts(tuitionId),
    teacherNames(tuitionId),
  ]);
  return { batches: batches.map((b) => batchOut(b, names, counts.get(String(b._id)) ?? 0)) };
});

/** Creates a batch: name, track, subjects, class, venue, timings and teachers. */
export const POST = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const fields = await readBatch(await readJson(req), tuitionId);
  const batch = (await Batch.create({ ...fields, tuitionId })) as BatchDoc;
  return { batch: batchOut(batch, await teacherNames(tuitionId), 0) };
});
