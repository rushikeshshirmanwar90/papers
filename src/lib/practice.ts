import type { Types } from "mongoose";
import { badRequest, isObjectId, oneOf } from "@/lib/http";
import { pyqFilter } from "@/lib/pyq";
import { STANDARDS, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";
import PracticeAnswer from "@/models/PracticeAnswer";
import Question from "@/models/Question";

// Topic practice: the track's past-year questions, grouped the way the
// student's syllabus is (class → chapter → topic), with the student's own
// answers. Progress is PracticeAnswer: one record per student and question
// holding the latest answer, so counts come straight from it.

export const PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 20;
export const STATUSES = ["all", "unanswered", "answered", "incorrect"] as const;
export type PracticeStatus = (typeof STATUSES)[number];

export const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
export const chapterKey = (standard: string, chapter: string) => `${standard}|${low(chapter)}`;
export const topicKey = (standard: string, chapter: string, topic: string) => `${standard}|${low(chapter)}|${low(topic)}`;

/** One group of the track's PYQs: a class, chapter and topic as stored, and how many questions. */
export interface PyqGroup {
  standard: string;
  chapter: string;
  topic: string;
  questions: number;
}

const CACHE_MS = 10 * 60 * 1000;
const groupCache = new Map<string, { at: number; groups: PyqGroup[] }>();

/** Forgets the cached counts (for tests that change the bank). */
export const clearPracticeCache = () => groupCache.clear();

/** How many PYQs each chapter and topic of the subject has for the track (cached briefly, like the syllabus). */
export async function pyqGroups(track: Track, subject: SchoolSubject): Promise<PyqGroup[]> {
  const key = `${track}|${subject}`;
  const hit = groupCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.groups;
  const rows = await Question.aggregate<{ _id: { standard: string; chapter: string; topic: string | null }; n: number }>([
    // The class first so the standard/subject/chapter/topic index is used.
    { $match: { standard: { $in: [...STANDARDS] }, ...pyqFilter(track, subject), chapter: { $nin: ["", null] } } },
    { $group: { _id: { standard: "$standard", chapter: "$chapter", topic: "$topic" }, n: { $sum: 1 } } },
  ]);
  const groups = rows.map((r) => ({ standard: r._id.standard, chapter: r._id.chapter, topic: r._id.topic ?? "", questions: r.n }));
  groupCache.set(key, { at: Date.now(), groups });
  return groups;
}

/** A place in the syllabus to practise: a chapter, or one topic of it. */
export interface PracticeNode {
  subject: SchoolSubject;
  standard: SchoolStandard;
  chapter: string;
  /** null: every question of the chapter, those without a topic included. */
  topic: string | null;
}

const MAX_NAME = 200;

function name(value: string | null, label: string): string {
  const text = (value ?? "").trim();
  if (text.length > MAX_NAME) throw badRequest(`The ${label} name is too long.`);
  return text;
}

/** The chapter (and topic) from ?standard=&chapter=[&topic=]. */
export function readNode(params: URLSearchParams, subject: SchoolSubject): PracticeNode {
  const standard = oneOf({ standard: params.get("standard") }, "standard", STANDARDS, "a class");
  const chapter = name(params.get("chapter"), "chapter");
  if (!chapter) throw badRequest("Choose a chapter.");
  const topic = name(params.get("topic"), "topic");
  return { subject, standard, chapter, topic: topic || null };
}

/** ?status=, ?after= and ?limit= for a page of questions. */
export function readPage(params: URLSearchParams) {
  const status = params.get("status") ? oneOf({ status: params.get("status") }, "status", STATUSES, "a status") : "all";
  const after = params.get("after");
  if (after !== null && after !== "" && !isObjectId(after)) throw badRequest("after is not valid.");
  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw badRequest(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  return { status: status as PracticeStatus, after: after || null, limit };
}

/**
 * The Mongo filter for a node's questions, or null when the bank has none.
 * Names are matched the way the syllabus matches them (trimmed, any case) and
 * then queried as stored, so the count and the pages agree.
 */
export async function nodeFilter(track: Track, node: PracticeNode): Promise<Record<string, unknown> | null> {
  const groups = (await pyqGroups(track, node.subject)).filter(
    (g) => g.standard === node.standard && low(g.chapter) === low(node.chapter) && (node.topic === null || low(g.topic) === low(node.topic))
  );
  if (!groups.length) return null;
  const chapters = [...new Set(groups.map((g) => g.chapter))];
  const filter: Record<string, unknown> = { standard: node.standard, ...pyqFilter(track, node.subject), chapter: { $in: chapters } };
  if (node.topic !== null) {
    const topics = [...new Set(groups.map((g) => g.topic))];
    filter.topic = { $in: topics.includes("") ? [...topics, null] : topics };
  }
  return filter;
}

export type Answer = { selected: string; correct: boolean };

/** The student's latest answer to each question they've practised in the subject. */
export async function answersOf(studentId: Types.ObjectId | string, subject: SchoolSubject): Promise<Map<string, Answer & { questionId: Types.ObjectId }>> {
  const rows = await PracticeAnswer.find({ studentId, subject })
    .select("questionId selected correct")
    .lean<{ questionId: Types.ObjectId; selected: string; correct: boolean }[]>();
  return new Map(rows.map((r) => [String(r.questionId), { questionId: r.questionId, selected: r.selected, correct: r.correct }]));
}

/** Counts for one part of the syllabus, all from real questions and answers. */
export interface PracticeStats {
  questions: number;
  answered: number;
  correct: number;
  wrong: number;
  remaining: number;
  /** Whole-percent of answered ones right; null before any answer. */
  accuracy: number | null;
}

export function statsOf(questions: number, answered: number, correct: number): PracticeStats {
  return {
    questions,
    answered,
    correct,
    wrong: answered - correct,
    remaining: Math.max(0, questions - answered),
    accuracy: answered ? Math.round((correct / answered) * 100) : null,
  };
}

/** What the app gets of a question; the answer and solution only when `reveal`. */
export const QUESTION_FIELDS = "standard chapter topic source questionText optionA optionB optionC optionD answerType diagramUrls optionDiagramUrls";
export const ANSWER_FIELDS = "correctAnswer explanation explanationDiagramUrls";
