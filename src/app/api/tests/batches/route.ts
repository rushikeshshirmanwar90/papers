import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { programOf, questionBankOf } from "@/lib/school";
import Batch, { type BatchDoc } from "@/models/Batch";

export const dynamic = "force-dynamic";

/**
 * Every batch of the user's tuition that a test can be set for. A teacher may set
 * a test for any of them, not only the batches they teach. Read-only; own tuition only.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "tuition", "teacher");
  const batches = (await Batch.find({ tuitionId: session.tuitionId }).sort({ name: 1 })) as BatchDoc[];
  return {
    batches: batches.map((b) => ({
      id: String(b._id),
      name: b.name,
      program: programOf(b),
      standard: b.standard ?? null,
      subjects: b.subjects,
      questionBank: questionBankOf(programOf(b)),
    })),
  };
});
