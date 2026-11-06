import { requireUser } from "@/lib/auth";
import { badRequest, readJson, route } from "@/lib/http";
import { MAX_PAGE, pageOfQuestions, readScope } from "@/lib/makePdfBank";

export const dynamic = "force-dynamic";

/** One page of the matching MCQs (never more than MAX_PAGE), for the on-screen browser. */
export const POST = route(async (req) => {
  await requireUser(req, "teacher", "tuition");
  const body = await readJson(req);
  const scope = readScope(body);
  const page = body.page ?? 1;
  const limit = body.limit ?? 10;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) throw badRequest("page must be a whole number from 1.");
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw badRequest(`limit must be a whole number from 1 to ${MAX_PAGE}.`);
  return pageOfQuestions(scope, page, limit);
});
