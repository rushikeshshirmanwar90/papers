import { requireUser } from "@/lib/auth";
import { HttpError, isObjectId, listOf, notFound, oneOf, readJson, route } from "@/lib/http";
import { pushToUsers } from "@/lib/push";
import { PROGRAM_INFO, SUBJECTS } from "@/lib/school";
import { mustFit, readNewStudent, readStudentBatch } from "@/lib/tuition";
import JoinRequest from "@/models/JoinRequest";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Lets the person in, as a student or a teacher:
 * { as: "student", program (or an older app's track), standard, batchId? } or { as: "teacher", subjects }.
 * The batch must be of the student's program and class.
 * Their app switches to the student or teacher screens.
 */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId, user: tuitionUser } = await requireUser(req, "tuition");
  if (!isObjectId(params.id)) throw notFound("This request");
  const request = await JoinRequest.findOne({ _id: params.id, tuitionId, status: "pending" });
  if (!request) throw notFound("This request");
  if (request.batchId) throw new HttpError(400, "This student asked to join a batch. Approve them under People › Students.");
  const person = await User.findById(request.userId);
  if (!person) throw notFound("This person");
  if (person.tuitionId) throw new HttpError(409, `${person.name} has already joined a tuition.`);

  const body = await readJson(req);
  const as = oneOf(body, "as", ["student", "teacher"] as const, "student or teacher");
  person.tuitionId = request.tuitionId;
  person.role = as;
  if (as === "student") {
    const { program, standard } = readNewStudent(body);
    const batch = await readStudentBatch(body.batchId, tuitionId);
    mustFit({ program, standard }, batch);
    person.program = program;
    person.track = PROGRAM_INFO[program].track;
    person.standard = standard;
    person.batchId = batch?._id ?? null;
    person.subjects = [];
  } else {
    const subjects = listOf(body, "subjects", SUBJECTS, "Subjects");
    if (!subjects.length) throw new HttpError(400, "Pick the subjects they teach.");
    person.subjects = subjects;
  }
  await person.save();

  request.status = "accepted";
  request.acceptedAs = as;
  request.decidedAt = new Date();
  await request.save();
  // Any other pending requests of theirs are moot now.
  await JoinRequest.updateMany({ userId: person._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() });

  await pushToUsers([String(person._id)], {
    title: `Welcome to ${tuitionUser.name}`,
    body: `You've joined as a ${as}. Open the app to start.`,
    data: { tab: "home", kind: "joined" },
  });
  return { ok: true, as };
});
