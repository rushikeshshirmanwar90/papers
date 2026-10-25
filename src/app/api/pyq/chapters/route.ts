import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { pyqFilter, readSubject } from "@/lib/pyq";
import PracticeAnswer from "@/models/PracticeAnswer";
import Question from "@/models/Question";

export const dynamic = "force-dynamic";

/**
 * The chapters of a subject that have past-year questions for the student's
 * track (?subject=Physics), how many each has, and how many the student has
 * practised and got right.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req);
  const track = session.user.track ?? "General";
  const subject = readSubject(req.nextUrl.searchParams.get("subject"), track);

  const groups = await Question.aggregate<{ _id: { chapter: string; standard: string }; n: number; ids: Types.ObjectId[] }>([
    { $match: pyqFilter(track, subject) },
    { $match: { chapter: { $nin: ["", null] } } },
    { $group: { _id: { chapter: "$chapter", standard: "$standard" }, n: { $sum: 1 }, ids: { $push: "$_id" } } },
  ]);
  const practised = await PracticeAnswer.find({ studentId: session.user._id, questionId: { $in: groups.flatMap((g) => g.ids) } })
    .select("questionId correct")
    .lean<{ questionId: Types.ObjectId; correct: boolean }[]>();
  const result = new Map(practised.map((p) => [String(p.questionId), p.correct]));

  const chapters = groups
    .map((g) => {
      const mine = g.ids.filter((id) => result.has(String(id)));
      return {
        chapter: g._id.chapter,
        standard: g._id.standard,
        questions: g.n,
        practised: mine.length,
        correct: mine.filter((id) => result.get(String(id))).length,
      };
    })
    .sort((a, b) => a.standard.localeCompare(b.standard) || a.chapter.localeCompare(b.chapter, undefined, { numeric: true }));
  return { subject, track, total: chapters.reduce((n, c) => n + c.questions, 0), chapters };
});
