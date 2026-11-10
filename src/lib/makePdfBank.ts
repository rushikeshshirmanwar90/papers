import { Types } from "mongoose";
import { badRequest } from "@/lib/http";
import Question, { NOT_A_BANK_COPY, NOT_FLAGGED } from "@/models/Question";

// Question discovery for the one-page Make PDF screen. Read-only: it never
// writes a question. Everything is MCQs only, never a bank-copy duplicate, and
// scoped by course (Foundation or Competitive), class, subject and source.
//
//  - Foundation: examCategory "Foundation", classes 9th/10th, subjects
//    Mathematics and Science (not split into Physics/Chemistry/Biology).
//    Regular MCQs only: nothing in the data tells a Foundation PYQ reliably.
//  - Competitive: examCategory "JEE/NEET", classes 11th/12th. JEE has Physics,
//    Chemistry, Mathematics; NEET has Physics, Chemistry, Biology.
//      regular: every MCQ of the subject, sourced or not (not labelled PYQ).
//      pyq:     only questions whose source names that exam, with a year, and
//               no other entrance exam (BITSAT, MHT CET, KCET…) and not both
//               JEE and NEET.
//
// The same course rules are copied in pcmb-paper/src/screens/teacher/make-pdf/
// bank-scope.ts. Change both together.

export const COURSES = ["Foundation", "Competitive"] as const;
export type Course = (typeof COURSES)[number];
export type QuestionSource = "regular" | "pyq";
export type CompetitiveExam = "JEE" | "NEET";

export const COURSE_CLASSES: Record<Course, readonly string[]> = { Foundation: ["9th", "10th"], Competitive: ["11th", "12th"] };
export const FOUNDATION_SUBJECTS = ["Mathematics", "Science"] as const;
export const COMPETITIVE_SUBJECTS: Record<CompetitiveExam, readonly string[]> = {
  JEE: ["Physics", "Chemistry", "Mathematics"],
  NEET: ["Physics", "Chemistry", "Biology"],
};
/** Names the bank may file a subject under (Biology as Botany and Zoology). */
const BANK_NAMES: Record<string, string[]> = { Biology: ["Biology", "Botany", "Zoology"] };

export const MAX_PAGE = 50;
export const MAX_RANDOM = 300;
export const MAX_IDS = 300;
const MAX_NAMES = 200;

// ─── What a source names ───────────────────────────────────────────────────

const YEAR = "\\b((?:19|20)\\d{2})\\b";
/** Whole-word exam names, as regular-expression text for Mongo (PCRE) and JavaScript alike. */
const OWN: Record<CompetitiveExam, string> = {
  JEE: "\\b(JEE[ -]?(MAIN|MAINS|ADVANCED|ADV)?|AIEEE|IIT[ -]?JEE)\\b",
  NEET: "\\b(NEET|AIPMT)\\b",
};
/** Other entrance exams: a source naming any of them is never counted as JEE or NEET. */
const OTHER =
  "\\b(BITSAT|MHT|CET|KCET|WBJEE|COMEDK|EAMCET|VITEEE|SRMJEEE|UPSEE|KEAM|GUJCET|BCECE|OJEE|AIIMS|JIPMER|CUET|NDA|BOARD|HSC|FOUNDATION|OLYMPIAD|NTSE|KVPY)\\b";

const own = (exam: CompetitiveExam) => new RegExp(OWN[exam], "i");
const other = new RegExp(OTHER, "i");

/** The exam a source names, only when it names exactly one exam, a year, and no other entrance exam; else null. */
export function pyqExamOf(source: string | null | undefined): CompetitiveExam | null {
  const text = source ?? "";
  if (!text || other.test(text) || !new RegExp(YEAR).test(text)) return null;
  const jee = own("JEE").test(text);
  const neet = own("NEET").test(text);
  return jee === neet ? null : jee ? "JEE" : "NEET";
}

/** The year in a source, or null. */
export const yearOf = (source: string | null | undefined): string | null => new RegExp(YEAR).exec(source ?? "")?.[1] ?? null;

// ─── The scope ─────────────────────────────────────────────────────────────

export interface BankScope {
  course: Course;
  standard: string;
  exam: CompetitiveExam | null;
  subject: string;
  source: QuestionSource;
  chapters: string[];
  topics: string[];
  years: string[];
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (value: string) => new RegExp(`^\\s*${escapeRegex(value.trim())}\\s*$`, "i");

function names(value: unknown, field: string): string[] {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.length > MAX_NAMES) throw badRequest(`${field} has too many entries.`);
  return [...new Set(list.map((item) => {
    if (typeof item !== "string" || item.length > 300) throw badRequest(`${field} must be a list of names.`);
    return item.trim();
  }).filter(Boolean))];
}

/** Checks the choices against the course's rules and returns them cleaned, or a 400. */
export function readScope(raw: Record<string, unknown>): BankScope {
  const course = raw.course;
  if (course !== "Foundation" && course !== "Competitive") throw badRequest("Choose Foundation or Competitive.");
  const standard = raw.standard;
  if (typeof standard !== "string" || !COURSE_CLASSES[course].includes(standard)) throw badRequest(`Choose a class: ${COURSE_CLASSES[course].join(" or ")}.`);
  const subject = raw.subject;
  if (typeof subject !== "string") throw badRequest("Choose a subject.");
  let exam: CompetitiveExam | null = null;
  if (course === "Competitive") {
    if (raw.exam !== "JEE" && raw.exam !== "NEET") throw badRequest("Choose JEE or NEET.");
    exam = raw.exam;
    if (!COMPETITIVE_SUBJECTS[exam].includes(subject)) throw badRequest(`${subject} isn't part of ${exam}.`);
  } else if (!(FOUNDATION_SUBJECTS as readonly string[]).includes(subject)) {
    throw badRequest("Foundation has Mathematics and Science.");
  }
  const source = raw.source ?? "regular";
  if (source !== "regular" && source !== "pyq") throw badRequest("source must be regular or pyq.");
  if (source === "pyq" && course === "Foundation") throw badRequest("Foundation has no previous-year questions yet.");
  const years = names(raw.years, "years");
  if (!years.every((year) => /^(19|20)\d{2}$/.test(year))) throw badRequest("years must be four-digit years.");
  return { course, standard, exam, subject, source, chapters: names(raw.chapters, "chapters"), topics: names(raw.topics, "topics"), years };
}

/**
 * The Mongo filter for a scope. `skip` leaves out a level of choice, so the
 * options for it can be counted without that choice narrowing them.
 */
export function scopeFilter(scope: BankScope, skip: { chapters?: boolean; topics?: boolean; years?: boolean } = {}): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  const filter: Record<string, unknown> = {
    ...NOT_A_BANK_COPY,
    // Broken options: not offered for new tests or papers (and refused if sent) until fixed.
    ...NOT_FLAGGED,
    examCategory: scope.course === "Foundation" ? "Foundation" : "JEE/NEET",
    standard: scope.standard,
    subject: { $in: BANK_NAMES[scope.subject] ?? [scope.subject] },
    answerType: "MCQ",
  };
  if (scope.source === "pyq" && scope.exam) {
    and.push({ source: { $regex: OWN[scope.exam], $options: "i" } });
    and.push({ source: { $not: new RegExp(OTHER, "i") } });
    and.push({ source: { $regex: YEAR } });
    // Never both exams in one source.
    const rival: CompetitiveExam = scope.exam === "JEE" ? "NEET" : "JEE";
    and.push({ source: { $not: own(rival) } });
    if (!skip.years && scope.years.length) and.push({ $or: scope.years.map((year) => ({ source: { $regex: `\\b${year}\\b` } })) });
  }
  if (!skip.chapters && scope.chapters.length) filter.chapter = { $in: scope.chapters.map(exactly) };
  if (!skip.topics && scope.topics.length) filter.topic = { $in: scope.topics.map(exactly) };
  if (and.length) filter.$and = and;
  return filter;
}

// ─── Options and questions ─────────────────────────────────────────────────

export interface Counted {
  name: string;
  count: number;
}

/** Counts grouped without regard to capitalisation; the commonest spelling names the group. */
function merge(rows: { name: string; n: number }[]): Counted[] {
  const groups = new Map<string, { best: string; bestN: number; count: number }>();
  for (const { name, n } of rows) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const group = groups.get(key) ?? { best: trimmed, bestN: 0, count: 0 };
    group.count += n;
    if (n > group.bestN) Object.assign(group, { best: trimmed, bestN: n });
    groups.set(key, group);
  }
  return [...groups.values()].map(({ best, count }) => ({ name: best, count })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export interface ScopeOptions {
  chapters: Counted[];
  topics: (Counted & { chapter: string })[];
  years: Counted[];
  total: number;
}

export async function scopeOptions(scope: BankScope): Promise<ScopeOptions> {
  const [chapterRows, topicRows, yearRows, total] = await Promise.all([
    // Chapters: the scope's own, whatever chapters, topics or years are chosen.
    Question.aggregate<{ _id: string | null; n: number }>([
      { $match: scopeFilter(scope, { chapters: true, topics: true, years: true }) },
      { $group: { _id: "$chapter", n: { $sum: 1 } } },
    ]),
    // Topics: only those of the chosen chapters (every chapter's when none is chosen).
    Question.aggregate<{ _id: { chapter: string | null; topic: string | null }; n: number }>([
      { $match: scopeFilter(scope, { topics: true, years: true }) },
      { $group: { _id: { chapter: "$chapter", topic: "$topic" }, n: { $sum: 1 } } },
    ]),
    scope.source === "pyq"
      ? Question.aggregate<{ _id: string | null; n: number }>([
          { $match: scopeFilter(scope, { years: true }) },
          { $group: { _id: { $regexFind: { input: "$source", regex: YEAR } }, n: { $sum: 1 } } },
          { $project: { _id: { $arrayElemAt: ["$_id.captures", 0] }, n: 1 } },
        ])
      : Promise.resolve([]),
    Question.countDocuments(scopeFilter(scope)),
  ]);
  const chapters = merge(chapterRows.map((row) => ({ name: row._id ?? "", n: row.n })));
  const topicMap = new Map<string, { chapter: string; name: string; n: number }>();
  const chapterName = (raw: string) => chapters.find((c) => c.name.toLowerCase() === raw.trim().toLowerCase())?.name ?? raw.trim();
  for (const { _id, n } of topicRows) {
    const topic = (_id.topic ?? "").trim();
    if (!topic) continue;
    const chapter = chapterName(_id.chapter ?? "");
    const key = `${chapter.toLowerCase()}|${topic.toLowerCase()}`;
    const entry = topicMap.get(key) ?? { chapter, name: topic, n: 0 };
    entry.n += n;
    topicMap.set(key, entry);
  }
  const topics = [...topicMap.values()]
    .map(({ chapter, name, n }) => ({ chapter, name, count: n }))
    .sort((a, b) => a.chapter.localeCompare(b.chapter, undefined, { numeric: true }) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const years = merge(yearRows.map((row) => ({ name: row._id ?? "", n: row.n }))).sort((a, b) => Number(b.name) - Number(a.name));
  return { chapters, topics, years, total };
}

const ORDER = { chapter: 1, paperId: 1, questionNumber: 1 } as const;

/** One page of the scope's questions, in paper order. */
export async function pageOfQuestions(scope: BankScope, page: number, limit: number) {
  const filter = scopeFilter(scope);
  const [questions, total] = await Promise.all([
    Question.find(filter).sort(ORDER).skip((page - 1) * limit).limit(limit).lean<Record<string, unknown>[]>(),
    Question.countDocuments(filter),
  ]);
  return { questions, total, page, limit, hasMore: page * limit < total };
}

/** `count` questions chosen at random from the scope (never from outside it), skipping `exclude`; fewer when fewer exist. */
export async function randomQuestions(scope: BankScope, count: number, exclude: string[]) {
  const filter = scopeFilter(scope);
  const skipped = exclude.map((id) => new Types.ObjectId(id));
  const eligible = skipped.length ? { ...filter, _id: { $nin: skipped } } : filter;
  const sampled = await Question.aggregate<{ _id: Types.ObjectId }>([{ $match: eligible }, { $project: { _id: 1 } }, { $sample: { size: count } }]).option({ allowDiskUse: true });
  const ids = sampled.map((doc) => doc._id);
  const questions = ids.length ? await Question.find({ _id: { $in: ids } }).sort(ORDER).lean<Record<string, unknown>[]>() : [];
  return { questions, found: questions.length, requested: count };
}

/** The questions with these ids that are inside the scope, in the order the ids were given; the rest are counted as dropped. */
export async function verifyQuestions(scope: BankScope, ids: string[]) {
  const unique = [...new Set(ids)];
  const docs = unique.length ? await Question.find({ ...scopeFilter(scope), _id: { $in: unique.map((id) => new Types.ObjectId(id)) } }).lean<Record<string, unknown>[]>() : [];
  const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
  const questions = unique.map((id) => byId.get(id)).filter((doc): doc is Record<string, unknown> => !!doc);
  return { questions, dropped: unique.length - questions.length };
}
