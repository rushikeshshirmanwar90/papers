import { hasManagedAccess, accessOf, audienceBatches, mustBeBankQuestions, rosterStudents, sharedScope } from '@/lib/test-access';
import { requireUser } from "@/lib/auth";
import { badRequest, HttpError, isObjectId, readJson, route, text } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import { pushToUsers } from "@/lib/push";
import { batchForTest } from "@/lib/teaching";
import { SUBJECTS, programOf, questionBankOf, type SchoolSubject } from "@/lib/school";
import { readDuration, readMarking, readQuestions, readWhen, resolveSchedule, testSummaries } from "@/lib/tests";
import { Types } from "mongoose";
import { createHash } from 'node:crypto';
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
  // A teacher also sees the tests they set, even for a batch they don't teach.
  if (ids !== 'all') filter.$or = [{ batchId: { $in: ids } }, { batchIds: { $in: ids } }, ...(session.role === 'teacher' ? [{ teacherId: session.user._id }] : [])];
  if (session.role === 'student') {
    const mine = await TestAttempt.distinct('testId', { tuitionId: session.tuitionId, studentId: session.user._id });
    filter.$or = [{ batchId: { $in: session.user.batchId ? [session.user.batchId] : [] } }, { batchIds: { $in: session.user.batchId ? [session.user.batchId] : [] } }, { _id: { $in: mine } }];
  }
  const only = req.nextUrl.searchParams.get("batchId");
  if (isObjectId(only)) filter.$and = [ids === 'all' || ids.some(id => String(id) === only) ? { $or: [{ batchId: only }, { batchIds: only }] } : { _id: { $in: [] } }];
  const upcoming = req.nextUrl.searchParams.get("upcoming") === "1";
  if (session.role === "student" && !upcoming) filter.opensAt = { $lte: new Date() };
  const tests = (await TestRoom.find(filter).select("-questions.explanation").sort({ opensAt: -1 }).limit(200)) as TestRoomDoc[];
  const summaries = await testSummaries(tests);
  if (session.role !== "student") return { tests: summaries };

  // A student also sees where they are with each test.
  const attempts = await TestAttempt.find({ studentId: session.user._id, testId: { $in: tests.map((t) => t._id) } })
    .select("testId score submittedAt suspendedAt")
    .lean<{ testId: Types.ObjectId; score: number; submittedAt: Date | null; suspendedAt?: Date | null }[]>();
  return {
    tests: await Promise.all(summaries.map(async (t, index) => {
      const access = await accessOf(tests[index], session);
      const a = attempts.find((x) => String(x.testId) === t.id);
      return { ...t, ...(hasManagedAccess(tests[index]) && !access.allowed ? { averageScore: null, started: 0, submitted: 0, batchStudents: 0 } : {}), access, mine: a ? { state: a.submittedAt ? "submitted" : a.suspendedAt ? "suspended" : "in-progress", score: a.submittedAt && t.status === "closed" ? a.score : null } : null };
    })),
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
  const requestId = body.requestId;
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(requestId))) throw badRequest('A valid creation request ID is required.');
  const creationFingerprint = requestId ? createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'requestId').sort(([a], [b]) => a.localeCompare(b))))).digest('hex') : undefined;
  const previousCreation = async () => {
    const previous = requestId ? await TestRoom.findOne({ tuitionId: session.tuitionId, teacherId: session.user._id, creationRequestId: requestId }) as TestRoomDoc | null : null;
    if (previous && previous.creationFingerprint !== creationFingerprint) throw new HttpError(409, 'This creation request already published a different test. Refresh test history before trying again.');
    return previous;
  };
  const previous = await previousCreation();
  if (previous) return { test: (await testSummaries([previous]))[0] };
  // Next dev can retain a Mongoose model compiled before audience fields existed.
  // Refuse publication instead of silently stripping permissions and creating a legacy test.
  if (!TestRoom.schema.path('accessVersion') || !TestRoom.schema.path('roster') || !TestRoom.schema.path('audienceMode')) throw new HttpError(503, 'Restart the backend to load test access management before publishing this test.');
  if (body.audienceMode === undefined && Array.isArray(body.studentIds) && body.studentIds.length) throw badRequest('Choose Selected students only when selecting allowed students.');
  const batch = await batchForTest(session, Array.isArray(body.batchIds) ? body.batchIds[0] : body.batchId);
  // Only JEE and NEET have questions; other programs never borrow theirs.
  if (!questionBankOf(programOf(batch))) throw badRequest(`There is no question bank for ${batch.name}'s program yet, so a test can't be set for it.`);
  const subject = text(body, "subject", { required: true, max: 40, label: "a subject" })!;
  if (!(SUBJECTS as readonly string[]).includes(subject)) throw badRequest("Pick one of the batch's subjects.");
  if (!batch.subjects.includes(subject as SchoolSubject)) throw badRequest(`${subject} isn't one of ${batch.name}'s subjects.`);

  const batches = await audienceBatches(session, body.batchIds ?? [body.batchId], subject);
  const scope = sharedScope(batches, subject, text(body, "standard", { max: 10 }) ?? "");
  const questions = readQuestions(body.questions);
  await mustBeBankQuestions(scope, questions);
  const candidates = await rosterStudents(session.tuitionId, batches.map(b => b._id));
  if (body.audienceMode !== undefined && !['all', 'selected'].includes(String(body.audienceMode))) throw badRequest('Choose a valid audience mode.');
  const audienceMode = body.audienceMode === 'selected' ? 'selected' : 'all';
  const readIds = (value: unknown) => {
    if (value === undefined) return new Set<string>();
    if (!Array.isArray(value) || value.some(id => !isObjectId(id) || !candidates.some(s => String(s._id) === id))) throw badRequest('Select eligible students from the chosen batches.');
    return new Set(value as string[]);
  };
  const selected = readIds(body.studentIds), excluded = readIds(body.excludedStudentIds);
  if (audienceMode === 'selected' && !selected.size) throw badRequest('Select at least one student.');
  const roster = candidates.map(s => ({ studentId: s._id, allowed: !excluded.has(String(s._id)) && (audienceMode !== 'selected' || selected.has(String(s._id))), started: false, request: null }));
  if (audienceMode === 'selected' && !roster.some(r => r.allowed)) throw badRequest('Select at least one student who is not excluded.');
  const durationMinutes = readDuration(body.durationMinutes, 60);
  const { opensAt, closesAt } = resolveSchedule({
    startNow: body.startNow === true,
    opensAt: readWhen(body.opensAt, "The start time", null),
    closesAt: readWhen(body.closesAt, "The end time", null),
    durationMinutes,
  });

  let created = true;
  const test = (await TestRoom.create({
    tuitionId: session.tuitionId,
    creationRequestId: requestId, creationFingerprint,
    accessVersion: 1, batchIds: batches.map(b => b._id), audienceMode, roster,
    batchId: batch._id,
    teacherId: session.user._id,
    title: text(body, "title", { required: true, max: 120, label: "a test name" }),
    subject,
    standard: scope.standard,
    questions,
    ...readMarking(body),
    durationMinutes,
    opensAt,
    closesAt,
  }).catch(async error => {
    if (requestId && error?.code === 11000) {
      const existing = await previousCreation();
      if (existing) { created = false; return existing; }
    }
    throw error;
  })) as TestRoomDoc;
  if (!created) return { test: (await testSummaries([test]))[0] };

  const opensNow = test.opensAt.getTime() <= Date.now() + 60 * 1000;
  await pushToUsers(roster.filter(r => r.allowed).map(r => r.studentId as Types.ObjectId), {
    title: opensNow ? `New test: ${test.title}` : `Test coming up: ${test.title}`,
    body: opensNow
      ? `${test.questions.length} questions · ${test.durationMinutes} min. Open it from your Tests tab.`
      : `Opens ${test.opensAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`,
    data: { tab: "tests", kind: "test", testId: String(test._id) },
  });
  return { test: (await testSummaries([test]))[0] };
});
