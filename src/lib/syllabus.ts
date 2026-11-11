import type { Types } from "mongoose";
import { STANDARDS, type SchoolStandard, type SchoolSubject } from "@/lib/school";
import Question, { NOT_A_BANK_COPY } from "@/models/Question";
import SyllabusProgress from "@/models/SyllabusProgress";

// The syllabus of a subject, as the question bank knows it: its chapters for
// 11th and 12th, and each chapter's topics. A chapter without named topics is
// one unit of its own (topic ""). Coverage counts these units.

export interface SyllabusChapter {
  standard: SchoolStandard;
  chapter: string;
  /** "" alone when the chapter has no named topics. */
  topics: string[];
  questionCount: number;
}

// Question bank names for a subject: Biology papers may be split into Botany and Zoology.
export const BANK_SUBJECTS: Record<SchoolSubject, string[]> = {
  Physics: ["Physics"],
  Chemistry: ["Chemistry"],
  Mathematics: ["Mathematics"],
  Biology: ["Biology", "Botany", "Zoology"],
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; chapters: SyllabusChapter[] }>();
/** Lookups under way, so requests that arrive together share one question bank scan. */
const pending = new Map<string, Promise<SyllabusChapter[]>>();

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The subject's chapters and topics for the given classes (both when none given). */
export async function syllabusFor(subject: SchoolSubject, standards: readonly SchoolStandard[] = STANDARDS): Promise<SyllabusChapter[]> {
  const wanted = standards.length ? [...standards].sort() : [...STANDARDS];
  const key = `${subject}|${wanted.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.chapters;
  const running = pending.get(key);
  if (running) return running;
  const lookup = loadSyllabus(subject, wanted).then((list) => {
    cache.set(key, { at: Date.now(), chapters: list });
    return list;
  });
  pending.set(key, lookup);
  return lookup.finally(() => pending.delete(key));
}

async function loadSyllabus(subject: SchoolSubject, wanted: SchoolStandard[]): Promise<SyllabusChapter[]> {
  const groups = await Question.aggregate<{ _id: { standard: SchoolStandard; chapter: string; topic: string }; n: number }>([
    {
      $match: {
        ...NOT_A_BANK_COPY,
        examCategory: "JEE/NEET",
        standard: { $in: wanted },
        subject: { $in: BANK_SUBJECTS[subject] },
        chapter: { $nin: ["", null] },
      },
    },
    { $group: { _id: { standard: "$standard", chapter: "$chapter", topic: { $ifNull: ["$topic", ""] } }, n: { $sum: 1 } } },
  ]);

  const chapters = new Map<string, SyllabusChapter>();
  for (const { _id, n } of groups) {
    const chapterKey = `${_id.standard}|${_id.chapter}`;
    const entry = chapters.get(chapterKey) ?? { standard: _id.standard, chapter: _id.chapter.trim(), topics: [], questionCount: 0 };
    entry.questionCount += n;
    const topic = (_id.topic ?? "").trim();
    if (topic && !entry.topics.includes(topic)) entry.topics.push(topic);
    chapters.set(chapterKey, entry);
  }
  const list = [...chapters.values()]
    .map((c) => ({ ...c, topics: c.topics.length ? c.topics.sort(byName) : [""] }))
    .sort((a, b) => a.standard.localeCompare(b.standard) || byName(a.chapter, b.chapter));

  return list;
}

/** The classes a batch studies: its own, or both when it has none set. */
export const standardsOf = (standard?: SchoolStandard | null): SchoolStandard[] => (standard ? [standard] : [...STANDARDS]);

const unitKey = (standard: string, chapter: string, topic: string) => `${standard}|${chapter.toLowerCase()}|${topic.toLowerCase()}`;

/**
 * How much of each subject the batches have covered: covered units, all units
 * and the percentage, per batch and subject.
 */
export async function coverageFor(
  batches: { _id: Types.ObjectId; subjects: SchoolSubject[]; standard?: SchoolStandard | null }[]
): Promise<Map<string, Record<string, { covered: number; total: number; percent: number }>>> {
  const progress = await SyllabusProgress.find({ batchId: { $in: batches.map((b) => b._id) } })
    .select("batchId subject standard chapter topic")
    .lean<{ batchId: Types.ObjectId; subject: SchoolSubject; standard: string; chapter: string; topic: string }[]>();

  // Grouped once by batch and subject, rather than scanned again for each of them.
  const marked = new Map<string, typeof progress>();
  for (const p of progress) {
    const at = `${String(p.batchId)}|${p.subject}`;
    const list = marked.get(at);
    if (list) list.push(p);
    else marked.set(at, [p]);
  }

  const result = new Map<string, Record<string, { covered: number; total: number; percent: number }>>();
  // Every batch's subject syllabuses load side by side, not one batch after another.
  const allSyllabuses = await Promise.all(batches.map((batch) => Promise.all(batch.subjects.map((subject) => syllabusFor(subject, standardsOf(batch.standard))))));
  for (const [b, batch] of batches.entries()) {
    const perSubject: Record<string, { covered: number; total: number; percent: number }> = {};
    const syllabuses = allSyllabuses[b];
    for (const [i, subject] of batch.subjects.entries()) {
      const syllabus = syllabuses[i];
      const units = new Set(syllabus.flatMap((c) => c.topics.map((t) => unitKey(c.standard, c.chapter, t))));
      const covered = new Set(
        (marked.get(`${String(batch._id)}|${subject}`) ?? [])
          .map((p) => unitKey(p.standard, p.chapter, p.topic))
          .filter((k) => units.has(k))
      );
      const total = units.size;
      perSubject[subject] = { covered: covered.size, total, percent: total ? Math.round((covered.size / total) * 100) : 0 };
    }
    result.set(String(batch._id), perSubject);
  }
  return result;
}
