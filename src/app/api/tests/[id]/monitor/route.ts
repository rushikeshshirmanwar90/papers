import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { monitorTest } from "@/lib/test-monitor";
import { testFor } from "@/lib/tests";

export const dynamic = "force-dynamic";

/**
 * Who has started, is answering or has finished a test, for the tuition and the
 * teachers of its batch (testFor checks the tuition and the batch). Students are
 * refused. It holds no questions, answers or marks.
 */
export const GET = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  const { test } = await testFor(session, params.id);
  return monitorTest(test);
});
