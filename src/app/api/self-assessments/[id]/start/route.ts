import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { assessmentFor, detailOf, start } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/** Starts the clock (once) and returns the questions. Starting again just carries on. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "student");
  return detailOf(await start(await assessmentFor(session, params.id)));
});
