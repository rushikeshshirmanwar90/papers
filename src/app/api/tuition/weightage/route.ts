import { requireUser } from "@/lib/auth";
import { badRequest, oneOf, readJson, route } from "@/lib/http";
import { STANDARDS, SUBJECTS, SUBJECTS_BY_TRACK, TRACKS, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";
import { syllabusFor } from "@/lib/syllabus";
import ChapterWeightage from "@/models/ChapterWeightage";

export const dynamic = "force-dynamic";

function readScope(params: URLSearchParams | Record<string, unknown>) {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : params[k]);
  const scope = { track: get("track"), subject: get("subject") };
  const track = oneOf(scope, "track", TRACKS, "a track");
  const subject = oneOf(scope, "subject", SUBJECTS, "a subject");
  if (!SUBJECTS_BY_TRACK[track].includes(subject)) throw badRequest(`${subject} isn't part of the ${track} track.`);
  return { track, subject };
}

async function chaptersWithMarks(tuitionId: string, track: Track, subject: SchoolSubject) {
  const [syllabus, saved] = await Promise.all([
    syllabusFor(subject),
    ChapterWeightage.find({ tuitionId, track, subject }).lean<{ standard: SchoolStandard; chapter: string; marks: number }[]>(),
  ]);
  const marksOf = (standard: string, chapter: string) =>
    saved.find((w) => w.standard === standard && w.chapter.toLowerCase() === chapter.toLowerCase())?.marks ?? null;
  const chapters = syllabus.map((c) => ({ standard: c.standard, chapter: c.chapter, marks: marksOf(c.standard, c.chapter) }));
  return { chapters, totalMarks: chapters.reduce((sum, c) => sum + (c.marks ?? 0), 0) };
}

/**
 * Each chapter of a track's subject, with the marks the tuition says it
 * carries (null when not set). ?track=NEET&subject=Physics. Anyone in the
 * tuition can read it; students see it on their roadmap.
 */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req);
  const { track, subject } = readScope(req.nextUrl.searchParams);
  return { track, subject, ...(await chaptersWithMarks(tuitionId, track, subject)) };
});

/** Saves marks for chapters: { track, subject, chapters: [{ standard, chapter, marks | null }] }. */
export const PUT = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const body = await readJson(req);
  const { track, subject } = readScope(body);
  if (!Array.isArray(body.chapters) || body.chapters.length > 500) throw badRequest("Send the chapters as a list.");

  const ops = body.chapters.map((raw: unknown) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const standard = oneOf(entry, "standard", STANDARDS, "a class");
    const chapter = typeof entry.chapter === "string" ? entry.chapter.trim() : "";
    if (!chapter || chapter.length > 200) throw badRequest("Each chapter needs its name.");
    const key = { tuitionId, track, subject, standard, chapter };
    if (entry.marks === null || entry.marks === "" || entry.marks === undefined) return { deleteOne: { filter: key } };
    const marks = Number(entry.marks);
    if (!Number.isFinite(marks) || marks < 0 || marks > 1000) throw badRequest(`Marks for ${chapter} must be a number from 0 to 1000.`);
    return { updateOne: { filter: key, update: { $set: { marks } }, upsert: true } };
  });
  if (ops.length) await ChapterWeightage.bulkWrite(ops);
  return { track, subject, ...(await chaptersWithMarks(tuitionId, track, subject)) };
});
