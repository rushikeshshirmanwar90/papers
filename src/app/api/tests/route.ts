import { requireUser } from "@/lib/auth";
import { badRequest, isObjectId, readJson, route, text } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import { membersOf, pushToUsers } from "@/lib/push";
import { batchFor, mustTeach } from "@/lib/teaching";
import { SUBJECTS, programOf, questionBankOf, type SchoolSubject } from "@/lib/school";
import { readDuration, readMarking, readQuestions, readWhen, resolveSchedule, testSummaries } from "@/lib/tests";
import { Types } from "mongoose";
import TestAttempt from "@/models/TestAttempt";
import TestRoom, { type TestRoomDoc } from "@/models/TestRoom";

export const dynamic = "force-dynamic";

/**
 * Tests the user should see, newest first: the tuition's all, a teacher's
 * batches', a student's batch's. ?batchId= narrows to one batch.
 *
 * Students see a test once it opens. With ?upcoming=1 they also see the
 * scheduled ones, as summaries only (title, subject, times, counts): opening
 * or starting a scheduled test is still refused, so no question leaks early.
 * Opt-in, so older app versions (which would list them as missed) are unchanged.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req);
  const ids = await batchIdsOf(session);
  const filter: Record<string, unknown> = { tuitionId: session.tuitionId };
  if (ids !== "all") filter.batchId = { $in: ids };
  const only = req.nextUrl.searchParams.get("batchId");
  if (isObjectId(only)) filter.batchId = ids === "all" || ids.some((id) => String(id) === only) ? only : { $in: [] };
  const upcoming = req.nextUrl.searchParams.get("upcoming") === "1";
  if (session.role === "student" && !upcoming) filter.opensAt = { $lte: new Date() };
  const tests = (await TestRoom.find(filter).select("-questions.explanation").sort({ opensAt: -1 }).limit(200)) as TestRoomDoc[];
  const summaries = await testSummaries(tests);
  if (session.role !== "student") return { tests: summaries };

  // A student also sees where they are with each test.
  const attempts = await TestAttempt.find({ studentId: session.user._id, testId: { $in: tests.map((t) => t._id) } })
    .select("testId score submittedAt")
    .lean<{ testId: Types.ObjectId; score: number; submittedAt: Date | null }[]>();
  return {
    tests: summaries.map((t) => {
      const a = attempts.find((x) => String(x.testId) === t.id);
      return { ...t, mine: a ? { state: a.submittedAt ? "submitted" : "in-progress", score: a.submittedAt ? a.score : null } : null };
    }),
  };
});

/**
 * Sets a test for a batch:
 * { batchId, title, subject, standard?, durationMinutes, marksPerQuestion?, negativeMarks?, questions: […],
 *   startNow: true, closesAt }  opens at the server's clock now, or
 * { …, opensAt, closesAt }      opens later (in the future).
 * Times are ISO instants (UTC). The window must fit the whole time limit.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "tuition", "teacher");
  const body = await readJson(req);
  const batch = await batchFor(session, body.batchId);
  // Only JEE and NEET have questions; other programs never borrow theirs.
  if (!questionBankOf(programOf(batch))) throw badRequest(`There is no question bank for ${batch.name}'s program yet, so a test can't be set for it.`);
  const subject = text(body, "subject", { required: true, max: 40, label: "a subject" })!;
  if (!(SUBJECTS as readonly string[]).includes(subject)) throw badRequest("Pick one of the batch's subjects.");
  mustTeach(session, batch, subject as SchoolSubject);

  const durationMinutes = readDuration(body.durationMinutes, 60);
  const { opensAt, closesAt } = resolveSchedule({
    startNow: body.startNow === true,
    opensAt: readWhen(body.opensAt, "The start time", null),
    closesAt: readWhen(body.closesAt, "The end time", null),
    durationMinutes,
  });

  const test = (await TestRoom.create({
    tuitionId: session.tuitionId,
    batchId: batch._id,
    teacherId: session.user._id,
    title: text(body, "title", { required: true, max: 120, label: "a test name" }),
    subject,
    standard: text(body, "standard", { max: 10 }) ?? batch.standard ?? "",
    questions: readQuestions(body.questions),
    ...readMarking(body),
    durationMinutes,
    opensAt,
    closesAt,
  })) as TestRoomDoc;

  const opensNow = test.opensAt.getTime() <= Date.now() + 60 * 1000;
  await pushToUsers(await membersOf(session.tuitionId, [batch._id], ["student"]), {
    title: opensNow ? `New test: ${test.title}` : `Test coming up: ${test.title}`,
    body: opensNow
      ? `${test.questions.length} questions · ${test.durationMinutes} min. Open it from your Tests tab.`
      : `Opens ${test.opensAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`,
    data: { tab: "tests", kind: "test", testId: String(test._id) },
  });
  return { test: (await testSummaries([test]))[0] };
});
