import { requireUser } from "@/lib/auth";
import { badRequest, isObjectId, readJson, route } from "@/lib/http";
import { MAX_IDS, MAX_RANDOM, randomQuestions, readScope, verifyQuestions } from "@/lib/makePdfBank";

export const dynamic = "force-dynamic";

function idList(value: unknown, field: string, max: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || !value.every(isObjectId)) throw badRequest(`${field} must be a list of up to ${max} question ids.`);
  return value as string[];
}

/**
 * Two ways to get the exact questions for a PDF, both inside the chosen scope:
 *  - `ids`: the questions the teacher picked, checked against the scope; those
 *    outside it are dropped (and counted), the rest come back in the given order.
 *  - `count`: that many chosen at random (skipping `exclude`), the server
 *    deciding how many exist; the client's number is never trusted beyond its limit.
 */
export const POST = route(async (req) => {
  await requireUser(req, "teacher", "tuition");
  const body = await readJson(req);
  const scope = readScope(body);
  if (body.ids !== undefined) {
    const ids = idList(body.ids, "ids", MAX_IDS);
    if (ids.length === 0) throw badRequest("Pick at least one question.");
    return verifyQuestions(scope, ids);
  }
  const count = body.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_RANDOM) throw badRequest(`Ask for 1 to ${MAX_RANDOM} questions.`);
  return randomQuestions(scope, count, idList(body.exclude, "exclude", MAX_IDS));
});
