import { hashPassword } from "@/lib/auth";
import { HttpError, email, listOf, password, readJson, route, text } from "@/lib/http";
import { tuitionByCode } from "@/lib/join-code";
import { pushToUsers } from "@/lib/push";
import { SUBJECTS } from "@/lib/school";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * A teacher signs up with their tuition's join code:
 * { code, name, email, phone?, subjects, password }.
 * The account waits until the tuition approves it.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const tuition = await tuitionByCode(body.code);
  if (!tuition) {
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(404, "That code doesn't match any tuition. Check it with your tuition.");
  }
  const name = text(body, "name", { required: true, max: 100, label: "your name" })!;
  const address = email(body);
  const subjects = listOf(body, "subjects", SUBJECTS, "Subjects");
  if (!subjects.length) throw new HttpError(400, "Pick the subjects you teach.");
  const passwordHash = await hashPassword(password(body));

  if (await User.exists({ email: address })) {
    throw new HttpError(409, "An account with this email already exists. Log in instead, or ask your tuition.");
  }
  await User.create({
    role: "teacher",
    tuitionId: tuition._id,
    name,
    email: address,
    phone: text(body, "phone", { max: 20 }) ?? "",
    subjects,
    passwordHash,
    pending: true,
  });

  // Tell the tuition someone is waiting.
  const owner = await User.findOne({ tuitionId: tuition._id, role: "tuition" }).select("_id").lean<{ _id: unknown }>();
  if (owner) {
    await pushToUsers([String(owner._id)], {
      title: "A teacher wants to join",
      body: `${name} (${subjects.join(", ")}) signed up with your join code. Approve them on the Teachers tab.`,
      data: { tab: "teachers", kind: "join-request" },
    });
  }
  return { ok: true, tuition: { name: tuition.name } };
});
