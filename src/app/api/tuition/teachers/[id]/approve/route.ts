import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { pushToUsers } from "@/lib/push";
import { findMember, teacherOut } from "@/lib/tuition";

export const dynamic = "force-dynamic";

/** Approves a teacher who signed up with the join code; they can log in from now on. */
export const POST = route<{ params: { id: string } }>(async (req, { params }) => {
  const { tuitionId, user } = await requireUser(req, "tuition");
  const teacher = await findMember(tuitionId, params.id, "teacher");
  teacher.pending = false;
  await teacher.save();
  await pushToUsers([String(teacher._id)], { title: "You're in", body: `${user.name} approved your account. Log in to start.`, data: { tab: "home" } });
  return { teacher: teacherOut(teacher, []) };
});
