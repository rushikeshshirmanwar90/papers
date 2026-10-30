import type { Types } from "mongoose";
import { badRequest, notFound, objectId, readJson, route } from "@/lib/http";
import { assessmentUses, enumOf, inUse, requireBankAdmin } from "@/lib/question-bank";
import Paper from "@/models/Paper";
import Question from "@/models/Question";

// Editing and deleting one question of the shared bank: platform admin only
// (see lib/question-bank.ts).

type Context = { params: { id: string } };

/** The text fields that may be edited, with their longest allowed length. */
const TEXT_FIELDS = {
  questionText: 20000,
  optionA: 5000,
  optionB: 5000,
  optionC: 5000,
  optionD: 5000,
  correctAnswer: 50,
  explanation: 50000,
  source: 500,
} as const;
const ENUM_FIELDS = ["subject", "section", "answerType", "difficulty"] as const;

const EDITABLE = [...Object.keys(TEXT_FIELDS), ...ENUM_FIELDS, "questionNumber"];

/**
 * The edit from a request body: only the fields above, each checked. The web
 * editor sends the whole question back, so a field equal to what is stored
 * is left alone (old imports may hold values the checks would refuse), and
 * anything else in the body (_id, paperId, diagram URLs…) is ignored.
 */
function readQuestionUpdate(body: Record<string, unknown>, current: Record<string, unknown>) {
  if (!EDITABLE.some((field) => field in body)) throw badRequest("Send at least one field to change.");
  const changed = (field: string) => field in body && body[field] !== current[field] && !(body[field] == null && current[field] == null);

  const update: Record<string, string | number> = {};
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (!changed(field)) continue;
    const value = body[field];
    if (typeof value !== "string") throw badRequest(`${field} must be text.`);
    if (value.length > max) throw badRequest(`${field} is too long (at most ${max} characters).`);
    if (field === "questionText" && !value.trim()) throw badRequest("Enter the question text.");
    update[field] = value;
  }
  for (const field of ENUM_FIELDS) {
    if (!changed(field)) continue;
    const allowed = enumOf(Question, field);
    const value = body[field];
    if (typeof value !== "string" || !allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(", ")}.`);
    update[field] = value;
  }
  if (changed("questionNumber")) {
    const value = body.questionNumber;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10000) {
      throw badRequest("questionNumber must be a whole number from 1 to 10000.");
    }
    update.questionNumber = value;
  }
  return update;
}

export const PATCH = route<Context>(async (req, { params }) => {
  await requireBankAdmin(req);
  const id = objectId(params.id, "The question id");
  const body = await readJson(req);

  const current = await Question.findById(id).lean<Record<string, unknown>>();
  if (!current) throw notFound("This question");
  const update = readQuestionUpdate(body, current);
  if (!Object.keys(update).length) return current;

  const question = await Question.findByIdAndUpdate(id, update, { returnDocument: "after", runValidators: true }).lean();
  if (!question) throw notFound("This question");
  return question;
});

export const DELETE = route<Context>(async (req, { params }) => {
  await requireBankAdmin(req);
  const id = objectId(params.id, "The question id");

  const question = await Question.findById(id).select("_id paperId").lean<{ _id: Types.ObjectId; paperId: Types.ObjectId }>();
  if (!question) throw notFound("This question");

  const uses = await assessmentUses([question._id]);
  if (uses.length) throw inUse("This question", uses);

  const { deletedCount } = await Question.deleteOne({ _id: question._id });
  // Keep the paper's question count true.
  if (deletedCount) await Paper.updateOne({ _id: question.paperId, totalQuestions: { $gt: 0 } }, { $inc: { totalQuestions: -1 } });
  return { success: true };
});
