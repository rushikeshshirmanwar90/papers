import type { Types } from "mongoose";
import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { ADMIN_COOKIE } from "@/lib/admin-session";
import { requireAccount } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import Attempt from "@/models/Attempt";
import PracticeAnswer from "@/models/PracticeAnswer";
import TestRoom from "@/models/TestRoom";

// The question bank (papers and their questions) is shared by every tuition
// and records no owner, so only the platform admin may change it: tuition,
// teacher and student logins get a 403. Letting a tuition keep its own
// questions needs an owner on Question and Paper first.

/** The platform admin (console cookie or X-Admin-Key), or a 401/403. */
export async function requireBankAdmin(req: NextRequest): Promise<void> {
  if (req.headers.get("x-admin-key") !== null || req.cookies.get(ADMIN_COOKIE)?.value) {
    return requireAdmin(req);
  }
  if (req.headers.get("authorization")) {
    // A bad or expired app login is still a 401; a good one isn't enough.
    await requireAccount(req);
    throw new HttpError(403, "Only the platform admin can change the shared question bank.");
  }
  throw new HttpError(401, "Log in to the admin console to change the question bank.");
}

/** The allowed values of a string field with an enum, read from the model. */
export function enumOf(model: { modelName: string; schema: unknown }, path: string): string[] {
  const schema = model.schema as { path(name: string): { enumValues?: string[] } | undefined };
  const type = schema.path(path);
  if (!type?.enumValues?.length) throw new Error(`${model.modelName}.${path} has no enum`);
  return type.enumValues;
}

/**
 * What student history uses these questions (or this paper): past paper
 * attempts, practice answers and tests. Empty when nothing does. Until
 * archiving exists, anything in use must not be deleted.
 */
export async function assessmentUses(questionIds: Types.ObjectId[], paperId?: Types.ObjectId | string): Promise<string[]> {
  const [attempts, practice, tests] = await Promise.all([
    Attempt.exists(paperId ? { $or: [{ paperId }, { "answers.questionId": { $in: questionIds } }] } : { "answers.questionId": { $in: questionIds } }),
    questionIds.length ? PracticeAnswer.exists({ questionId: { $in: questionIds } }) : null,
    questionIds.length ? TestRoom.exists({ "questions.sourceId": { $in: questionIds } }) : null,
  ]);
  const uses: string[] = [];
  if (attempts) uses.push("students' paper attempts");
  if (practice) uses.push("students' practice answers");
  if (tests) uses.push("tests");
  return uses;
}

/** The 409 for something student history still uses. */
export function inUse(what: string, uses: string[]) {
  return new HttpError(
    409,
    `${what} can't be deleted because ${uses.join(", ")} use it. Deleting is blocked until archiving is added, so that no student history is lost.`
  );
}
