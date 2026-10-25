import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { badRequest, oneOf, readJson, route } from "@/lib/http";
import { STANDARDS, SUBJECTS, type SchoolSubject } from "@/lib/school";
import { standardsOf, syllabusFor } from "@/lib/syllabus";
import { batchFor, mustTeach } from "@/lib/teaching";
import SyllabusProgress from "@/models/SyllabusProgress";
import User from "@/models/User";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };
type Entry = { _id: Types.ObjectId; subject: SchoolSubject; standard: string; chapter: string; topic: string; coveredOn: Date; teacherId: Types.ObjectId; note: string };

const keyOf = (standard: string, chapter: string, topic: string) => `${standard}|${chapter.toLowerCase()}|${topic.toLowerCase()}`;

async function teacherNameMap(entries: Entry[]) {
  const users = await User.find({ _id: { $in: [...new Set(entries.map((e) => String(e.teacherId)))] } })
    .select("name")
    .lean<{ _id: Types.ObjectId; name: string }[]>();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

const entryOut = (e: Entry, names: Map<string, string>) => ({
  id: String(e._id),
  subject: e.subject,
  standard: e.standard,
  chapter: e.chapter,
  topic: e.topic,
  coveredOn: e.coveredOn,
  note: e.note,
  teacher: names.get(String(e.teacherId)) ?? "",
});

/**
 * What the batch has been taught. With ?subject=, that subject's whole
 * syllabus, each topic marked with when it was covered; always the latest
 * covered topics across subjects (?recent=, default 20), for "today's topics".
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req);
  const batch = await batchFor(session, params.id);
  const subjectParam = req.nextUrl.searchParams.get("subject");
  const recentLimit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("recent")) || 20, 1), 100);

  const recent = await SyllabusProgress.find({ batchId: batch._id }).sort({ coveredOn: -1, createdAt: -1 }).limit(recentLimit).lean<Entry[]>();
  let syllabus = null;
  let subjectEntries: Entry[] = [];
  if (subjectParam) {
    const subject = oneOf({ subject: subjectParam }, "subject", SUBJECTS, "a subject");
    if (!batch.subjects.includes(subject)) throw badRequest(`${subject} isn't one of ${batch.name}'s subjects.`);
    subjectEntries = await SyllabusProgress.find({ batchId: batch._id, subject }).lean<Entry[]>();
    const chapters = await syllabusFor(subject, standardsOf(batch.standard));
    syllabus = { subject, chapters };
  }
  const names = await teacherNameMap([...recent, ...subjectEntries]);
  const covered = new Map(subjectEntries.map((e) => [keyOf(e.standard, e.chapter, e.topic), e]));

  return {
    recent: recent.map((e) => entryOut(e, names)),
    syllabus: syllabus && {
      subject: syllabus.subject,
      chapters: syllabus.chapters.map((c) => ({
        standard: c.standard,
        chapter: c.chapter,
        topics: c.topics.map((topic) => {
          const e = covered.get(keyOf(c.standard, c.chapter, topic));
          return { topic, covered: e ? { on: e.coveredOn, by: names.get(String(e.teacherId)) ?? "" } : null };
        }),
      })),
    },
  };
});

function readDate(value: unknown): Date {
  if (value === undefined || value === null || value === "") return new Date();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest("The date must look like 2026-10-26.");
  const date = new Date(`${value}T12:00:00+05:30`);
  if (Number.isNaN(date.getTime())) throw badRequest("That date isn't valid.");
  if (date.getTime() > Date.now() + 36 * 3600 * 1000) throw badRequest("You can't mark a topic covered in the future.");
  return date;
}

/**
 * Marks topics of one chapter covered:
 * { subject, standard, chapter, topics: ["…"] (or [""] for the whole chapter), coveredOn?: "YYYY-MM-DD", note? }
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const batch = await batchFor(session, params.id);
  const body = await readJson(req);
  const subject = oneOf(body, "subject", SUBJECTS, "a subject");
  mustTeach(session, batch, subject);
  const standard = oneOf(body, "standard", STANDARDS, "a class");
  const chapter = typeof body.chapter === "string" ? body.chapter.trim() : "";
  if (!chapter) throw badRequest("Pick a chapter.");
  const topics = Array.isArray(body.topics) ? [...new Set(body.topics.map((t) => (typeof t === "string" ? t.trim() : "")))] : [];
  if (!topics.length || topics.length > 100) throw badRequest("Pick the topics you covered.");

  // Only topics that are in the syllabus.
  const syllabus = await syllabusFor(subject, standardsOf(batch.standard));
  const entry = syllabus.find((c) => c.standard === standard && c.chapter.toLowerCase() === chapter.toLowerCase());
  if (!entry) throw badRequest(`${chapter} isn't in the ${standard} ${subject} syllabus.`);
  const unknown = topics.filter((t) => !entry.topics.some((s) => s.toLowerCase() === t.toLowerCase()));
  if (unknown.length) throw badRequest(`Not in ${entry.chapter}: ${unknown.join(", ")}`);

  const coveredOn = readDate(body.coveredOn);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  await SyllabusProgress.bulkWrite(
    topics.map((topic) => ({
      updateOne: {
        filter: { batchId: batch._id, subject, standard, chapter: entry.chapter, topic: entry.topics.find((s) => s.toLowerCase() === topic.toLowerCase()) ?? topic },
        update: { $set: { tuitionId: batch.tuitionId, coveredOn, teacherId: session.user._id, note } },
        upsert: true,
      },
    }))
  );
  return { ok: true, marked: topics.length };
});

/** Unmarks a topic: ?subject=&standard=&chapter=&topic= (topic may be empty for a whole chapter). */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const batch = await batchFor(session, params.id);
  const q = req.nextUrl.searchParams;
  const subject = oneOf({ subject: q.get("subject") }, "subject", SUBJECTS, "a subject");
  mustTeach(session, batch, subject);
  const standard = oneOf({ standard: q.get("standard") }, "standard", STANDARDS, "a class");
  const chapter = q.get("chapter")?.trim();
  if (!chapter) throw badRequest("Pick a chapter.");
  await SyllabusProgress.deleteOne({ batchId: batch._id, subject, standard, chapter, topic: q.get("topic")?.trim() ?? "" });
  return { ok: true };
});
