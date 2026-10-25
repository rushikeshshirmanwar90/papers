import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { pyqFilter, readSubject } from "@/lib/pyq";
import PracticeAnswer from "@/models/PracticeAnswer";
import Question from "@/models/Question";

export const dynamic = "force-dynamic";

const PAGE = 20;

/**
 * Past-year questions to practise: ?subject=Physics[&chapter=…][&skip=0].
 * Newest papers first; each with the student's last answer if they tried it.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req);
  const params = req.nextUrl.searchParams;
  const track = session.user.track ?? "General";
  const subject = readSubject(params.get("subject"), track);
  const chapter = params.get("chapter")?.trim() || null;
  const skip = Math.max(0, Math.min(Number(params.get("skip")) || 0, 100000));

  const filter = pyqFilter(track, subject, chapter);
  const [total, questions] = await Promise.all([
    Question.countDocuments(filter),
    Question.find(filter)
      .sort({ source: -1, questionNumber: 1 })
      .skip(skip)
      .limit(PAGE)
      .select("subject standard chapter topic difficulty source questionText optionA optionB optionC optionD answerType correctAnswer explanation diagramUrls optionDiagramUrls explanationDiagramUrls")
      .lean<Record<string, unknown>[]>(),
  ]);
  const answers = await PracticeAnswer.find({ studentId: session.user._id, questionId: { $in: questions.map((q) => q._id as Types.ObjectId) } })
    .select("questionId selected correct")
    .lean<{ questionId: Types.ObjectId; selected: string; correct: boolean }[]>();

  return {
    subject,
    chapter,
    total,
    skip,
    nextSkip: skip + questions.length < total ? skip + questions.length : null,
    questions: questions.map((q) => {
      const mine = answers.find((a) => String(a.questionId) === String(q._id));
      return { ...q, _id: String(q._id), mine: mine ? { selected: mine.selected, correct: mine.correct } : null };
    }),
  };
});
