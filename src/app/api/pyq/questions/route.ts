import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { ANSWER_FIELDS, answersOf, nodeFilter, QUESTION_FIELDS, readNode, readPage, statsOf } from "@/lib/practice";
import { practiceBankOf, readSubject } from "@/lib/pyq";
import Question from "@/models/Question";
import { personalProfile } from '@/lib/ai-learning/profiles.mjs';
import { buildCompanion } from '@/lib/ai-learning/companion.mjs';
import { exactLearningNode, learningQualityFilter } from '@/lib/ai-learning/practice-policy';
import { connectDB } from '@/lib/db';
import { HttpError } from '@/lib/http';

export const dynamic = "force-dynamic";

/**
 * A page of past-year questions from one chapter or topic:
 * ?subject=Physics&standard=11th&chapter=…[&topic=…][&status=…][&after=<id>][&limit=10]
 *
 * status: all | unanswered (continue) | answered (review) | incorrect (retry).
 * Pages follow the question id, so `after` (the last id of the previous page)
 * gives the next page with no repeats, even while the student answers.
 * Answers and solutions come only with status=answered: the student has
 * answered those already. Otherwise the answer check returns them.
 * Programs without a question bank get none (`available: false`).
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const { user } = session;
  const params = req.nextUrl.searchParams;
  const subject = readSubject(params.get("subject"), user);
  const node = readNode(params, subject);
  const { status, after, limit } = readPage(params);
  const empty = { node, status, total: 0, summary: statsOf(0, 0, 0), questions: [], next: null };

  const bank = practiceBankOf(user);
  if (!bank) return { ...empty, available: false };
  let base = await nodeFilter(bank, node);
  if (!base) return empty;
  const learningCell = params.get('learningCell');
  if (learningCell) {
    if (learningCell.length > 2000) throw new HttpError(400, 'Choose a valid learning topic.');
    const profile = await personalProfile(await connectDB(), session);
    const area = buildCompanion(profile).areas.find((a: { key: string }) => a.key === learningCell);
    if (!area) throw new HttpError(404, 'Choose a topic from your current study plan.');
    const exact = exactLearningNode(area, learningCell);
    if (!exact || exact.subject !== node.subject || exact.standard !== node.standard || exact.chapter !== node.chapter || exact.topic !== node.topic) return empty;
    base = { ...base, ...learningQualityFilter(area.understanding?.name) };
  }

  // The student's answers within this chapter or topic.
  const mine = await answersOf(user._id as Types.ObjectId, subject);
  const inNode = mine.size
    ? await Question.find({ ...base, _id: { $in: [...mine.values()].map((a) => a.questionId) } })
        .select("_id")
        .lean<{ _id: Types.ObjectId }[]>()
    : [];
  const answeredIds = inNode.map((q) => q._id);
  const wrongIds = answeredIds.filter((id) => !mine.get(String(id))!.correct);
  const correct = answeredIds.length - wrongIds.length;

  const ids: Record<string, unknown> =
    status === "unanswered" ? { $nin: answeredIds } : status === "answered" ? { $in: answeredIds } : status === "incorrect" ? { $in: wrongIds } : {};
  const set = Object.keys(ids).length ? { ...base, _id: ids } : base;
  const page = after ? { ...base, _id: { ...ids, $gt: new Types.ObjectId(after) } } : set;
  const reveal = status === "answered";

  const [questions, total, nodeTotal] = await Promise.all([
    Question.find(page)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .select(reveal ? `${QUESTION_FIELDS} ${ANSWER_FIELDS}` : QUESTION_FIELDS)
      .lean<Record<string, unknown>[]>(),
    Question.countDocuments(set),
    status === "all" ? Promise.resolve(-1) : Question.countDocuments(base),
  ]);
  const shown = questions.slice(0, limit);

  return {
    node,
    status,
    total,
    summary: statsOf(nodeTotal < 0 ? total : nodeTotal, answeredIds.length, correct),
    questions: shown.map((q) => {
      const answer = mine.get(String(q._id));
      return { ...q, _id: String(q._id), mine: answer ? { selected: answer.selected, correct: answer.correct } : null };
    }),
    next: questions.length > limit ? String(shown[shown.length - 1]._id) : null,
  };
});
