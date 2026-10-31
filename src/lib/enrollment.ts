import type { Types } from "mongoose";
import { HttpError } from "@/lib/http";
import { pushToUsers } from "@/lib/push";
import { inviteProblem } from "@/lib/batch-invite";
import { PROGRAM_INFO, programOf } from "@/lib/school";
import Batch, { type BatchDoc } from "@/models/Batch";
import JoinRequest, { type JoinRequestDoc } from "@/models/JoinRequest";
import User from "@/models/User";

// Deciding students' requests to join a batch. Approving changes the same
// membership every Student API reads (the user's tuition, role and batch), so
// the student gets the normal app at once; the request's status follows.

/**
 * Approves or rejects one pending teacher request of this tuition. Approving
 * gives the person the teacher role and the tuition membership, with the
 * subjects they asked with; it assigns no batch (the tuition does that from
 * Teachers and Batch Details). Throws a 404 when the request isn't a pending
 * teacher request of this tuition, and a 409 when the person can't be let in.
 */
export async function decideTeacher(tuitionId: string, adminName: string, requestId: string, action: "approve" | "reject") {
  const request = (await JoinRequest.findOne({ _id: requestId, tuitionId, status: "pending", role: "teacher" })) as JoinRequestDoc | null;
  if (!request) throw new HttpError(404, "This request is no longer waiting. Refresh and try again.");

  // Claim the request first, so two admins (or a double tap) can't both decide it.
  const claimed = await JoinRequest.findOneAndUpdate(
    { _id: request._id, tuitionId, status: "pending" },
    { status: action === "approve" ? "accepted" : "rejected", acceptedAs: action === "approve" ? "teacher" : null, decidedAt: new Date() }
  );
  if (!claimed) throw new HttpError(409, "Already decided.");
  if (action === "reject") return;

  // Only someone still without a tuition can be let in: never move a member.
  let joined: { modifiedCount: number };
  try {
    joined = await User.updateOne(
      { _id: request.userId, tuitionId: null, role: null, active: true },
      { tuitionId, role: "teacher", subjects: request.subjects }
    );
  } catch (error) {
    // The account wasn't changed: hand the request back so it can be approved again.
    console.error("[enrollment] couldn't update the account:", error);
    await JoinRequest.updateOne({ _id: request._id, status: "accepted" }, { status: "pending", acceptedAs: null, decidedAt: null });
    throw new HttpError(500, "Couldn't update their account. Try again.");
  }
  if (!joined.modifiedCount) {
    await JoinRequest.updateOne({ _id: request._id }, { status: "cancelled", acceptedAs: null, decidedAt: new Date() });
    throw new HttpError(409, "They have already joined a tuition, or their account is off.");
  }
  await JoinRequest.updateMany({ userId: request.userId, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
  await pushToUsers([request.userId], {
    title: "Welcome aboard",
    body: `${adminName} approved your request to teach. Open the app to start.`,
    data: { tab: "home", kind: "joined" },
  });
}

export interface EnrollmentResult {
  approved: number;
  rejected: number;
  failed: { id: string; name: string; reason: string }[];
}

/**
 * Decides the tuition's pending batch requests. Throws a 404 without changing
 * anything when any id isn't a pending batch request of this tuition.
 */
export async function decideEnrollments(tuitionId: string, adminName: string, ids: Types.ObjectId[], action: "approve" | "reject"): Promise<EnrollmentResult> {
  const requests = (await JoinRequest.find({ _id: { $in: ids }, tuitionId, status: "pending", batchId: { $ne: null } })) as JoinRequestDoc[];
  if (requests.length !== ids.length) throw new HttpError(404, "Some of these requests are no longer waiting. Refresh and try again.");

  const result: EnrollmentResult = { approved: 0, rejected: 0, failed: [] };
  const batches = new Map<string, BatchDoc | null>();
  const names = new Map((await User.find({ _id: { $in: requests.map((r) => r.userId) } }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>()).map((u) => [String(u._id), u.name]));

  for (const request of requests) {
    const id = String(request._id);
    const name = names.get(String(request.userId)) ?? "A student";
    const fail = (reason: string) => result.failed.push({ id, name, reason });

    // Read the batch before claiming, so a failed read leaves the request pending.
    const key = String(request.batchId);
    if (action === "approve" && !batches.has(key)) batches.set(key, (await Batch.findOne({ _id: request.batchId, tuitionId })) as BatchDoc | null);
    const batch = action === "approve" ? (batches.get(key) ?? null) : null;
    // A batch with no class set can't take students: leave the request waiting until the tuition sets it.
    if (batch?.active && !batch.standard) {
      fail(inviteProblem(batch)!);
      continue;
    }

    // Claim the request first, so two admins (or a double tap) can't both decide it.
    const claimed = await JoinRequest.findOneAndUpdate(
      { _id: request._id, tuitionId, status: "pending" },
      { status: action === "approve" ? "accepted" : "rejected", acceptedAs: action === "approve" ? "student" : null, decidedAt: new Date() }
    );
    if (!claimed) {
      fail("Already decided.");
      continue;
    }
    if (action === "reject") {
      result.rejected++;
      continue;
    }

    const program = batch ? programOf(batch) : null;
    const problem = !batch || !batch.active ? "Their batch is no longer open." : inviteProblem(batch);

    // Only someone still without a tuition can be let in: never move a member.
    let joined: { modifiedCount: number } | null = null;
    if (!problem && batch && program) {
      try {
        joined = await User.updateOne(
          { _id: request.userId, tuitionId: null, role: null, active: true },
          { tuitionId, role: "student", program, track: PROGRAM_INFO[program].track, standard: batch.standard, batchId: batch._id, subjects: [] }
        );
      } catch (error) {
        // The account wasn't changed: hand the request back so it can be approved again.
        console.error("[enrollment] couldn't update the account:", error);
        await JoinRequest.updateOne({ _id: request._id, status: "accepted" }, { status: "pending", acceptedAs: null, decidedAt: null });
        fail("Couldn't update their account. Try again.");
        continue;
      }
    }
    if (!joined?.modifiedCount) {
      await JoinRequest.updateOne({ _id: request._id }, { status: "cancelled", acceptedAs: null, decidedAt: new Date() });
      fail(problem ?? "They have already joined a tuition, or their account is off.");
      continue;
    }
    await JoinRequest.updateMany({ userId: request.userId, status: "pending" }, { status: "cancelled", decidedAt: new Date() });
    result.approved++;
    await pushToUsers([request.userId], {
      title: `Welcome to ${batch!.name}`,
      body: `${adminName} approved your request. Open the app to start.`,
      data: { tab: "home", kind: "joined" },
    });
  }
  return result;
}
