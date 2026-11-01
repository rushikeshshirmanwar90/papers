import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { resultsOf } from "@/lib/test-results";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/**
 * How a batch did on a test: the summary, the ranking of those who took it, who didn't,
 * each question's statistics and topic performance. For the tuition and the teachers of the
 * test's batch (testFor checks the tuition and the batch); students are refused.
 * Read-only: it scores nothing again and writes nothing but what finalizing an expired attempt does.
 */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test } = await testFor(session, params.id);
  return resultsOf(test);
});
