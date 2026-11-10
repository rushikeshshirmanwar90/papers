import { requireUser } from "@/lib/auth";
import { engagementSnapshot, studentOf } from "@/lib/engagement/award";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The student's progress for the Home header: XP, level and progress to the
 * next level, today's XP / goal / goalMet, streak and freezes. { enabled: false }
 * when the tuition has engagement switched off. Students only.
 */
export const GET = route(async (req) => {
  const session = await requireUser(req, "student");
  const me = await engagementSnapshot(studentOf(session));
  return me.enabled ? me.me : { enabled: false };
});
