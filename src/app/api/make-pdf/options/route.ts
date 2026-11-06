import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { readScope, scopeOptions } from "@/lib/makePdfBank";

export const dynamic = "force-dynamic";

/**
 * The chapters, topics, PYQ years and matching MCQ count for the one-page Make
 * PDF screen's choices. Read-only; teachers and tuition accounts, like the PDF.
 */
export const POST = route(async (req) => {
  await requireUser(req, "teacher", "tuition");
  return scopeOptions(readScope(await readJson(req)));
});
