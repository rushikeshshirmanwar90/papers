import { requireUser } from "@/lib/auth";
import { isObjectId, notFound, route } from "@/lib/http";
import { studentResultOf } from "@/lib/test-results";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/**
 * One student's attempt at a test, question by question, for the tuition and the teachers of the
 * test's batch. Students are refused; a student of another tuition is not found.
 */
export const GET = route<{ params: { id: string; studentId: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test } = await testFor(session, params.id);
  if (!isObjectId(params.studentId)) throw notFound("This student's result");
  return studentResultOf(test, params.studentId);
});
