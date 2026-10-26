import { NextRequest, NextResponse } from "next/server";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { notFound, objectId, route } from "@/lib/http";
import { assessmentUses, inUse, requireBankAdmin } from "@/lib/question-bank";
import Paper from "@/models/Paper";
import Question from "@/models/Question";
import { deleteFilesForPaper } from "@/lib/storage";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await connectDB();
  const paper = await Paper.findById(params.id).lean();
  if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

  const questions = await Question.find({ paperId: params.id }).sort({ questionNumber: 1 }).lean();

  return NextResponse.json({ paper, questions });
}

/**
 * Deletes a paper with its questions and stored files: platform admin only,
 * and only while no student history uses it. Attempts are never deleted.
 */
export const DELETE = route<{ params: { id: string } }>(async (req, { params }) => {
  await requireBankAdmin(req);
  const id = objectId(params.id, "The paper id");

  if (!(await Paper.exists({ _id: id }))) throw notFound("This paper");

  const questionIds = (await Question.find({ paperId: id }).select("_id").lean<{ _id: Types.ObjectId }[]>()).map((q) => q._id);
  const uses = await assessmentUses(questionIds, id);
  if (uses.length) throw inUse("This paper", uses);

  // Questions and files first, the paper last: if a step fails, the paper is
  // still listed and the delete can be tried again.
  await Question.deleteMany({ paperId: id });
  await deleteFilesForPaper(id);
  await Paper.deleteOne({ _id: id });
  return { success: true };
});
