import { requireAccount } from "@/lib/auth";
import { joinRequestPush, myRequestOut, resolveForPerson } from "@/lib/batch-invite";
import { HttpError, listOf, readJson, route } from "@/lib/http";
import { pushToUsers } from "@/lib/push";
import { SUBJECTS } from "@/lib/school";
import JoinRequest, { type JoinRequestDoc } from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Asks a tuition to let the person in: { code, subjects? }. The code decides
 * the role: a batch's joining code makes a student request for that batch, the
 * institute's teacher code a teacher request (which needs the PCMB subjects
 * they teach). The caller never names a role.
 * One request at a time: asking again with the same code returns the pending
 * request; a different code cancels it and sends a new one.
 */
export const POST = route(async (req) => {
  const { user } = await requireAccount(req);
  if (user.tuitionId) throw new HttpError(400, "You're already part of a tuition.");
  if (!user.emailVerified) throw new HttpError(403, "Verify your email first.");
  const body = await readJson(req);
  const resolved = await resolveForPerson(user._id, body.code);
  const batchId = resolved.kind === "batch" ? resolved.batch._id : null;
  const role = resolved.kind === "teacher" ? "teacher" : "student";
  let subjects: string[] = [];
  if (role === "teacher") {
    subjects = listOf(body, "subjects", SUBJECTS, "Subjects");
    if (!subjects.length) throw new HttpError(400, "Pick the subjects you teach.");
  }

  const same = (r: JoinRequestDoc | null) => !!r && String(r.tuitionId) === String(resolved.tuition._id) && String(r.batchId ?? "") === String(batchId ?? "");
  const pending = (await JoinRequest.findOne({ userId: user._id, status: "pending" })) as JoinRequestDoc | null;
  if (same(pending)) {
    // Asking again with the same teacher code may change the subjects.
    if (role === "teacher" && subjects.join() !== pending!.subjects.join()) {
      pending!.subjects = subjects;
      await pending!.save();
    }
    return { request: await myRequestOut(pending!) };
  }

  await JoinRequest.updateMany({ userId: user._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
  let request: JoinRequestDoc;
  try {
    request = (await JoinRequest.create({ userId: user._id, tuitionId: resolved.tuition._id, batchId, role, subjects })) as JoinRequestDoc;
  } catch (error) {
    // A second request of theirs got in first: it is the pending one.
    if ((error as { code?: number }).code !== 11000) throw error;
    const winner = (await JoinRequest.findOne({ userId: user._id, status: "pending" })) as JoinRequestDoc | null;
    if (!winner) throw error;
    return { request: await myRequestOut(winner) };
  }

  const owner = await User.findOne({ tuitionId: resolved.tuition._id, role: "tuition" }).select("_id").lean<{ _id: unknown }>();
  if (owner) {
    await pushToUsers([String(owner._id)], joinRequestPush(resolved, user.name));
  }
  return { request: await myRequestOut(request) };
});
