import { requireUser } from "@/lib/auth";
import { HttpError, isObjectId, notFound, route } from "@/lib/http";
import Announcement from "@/models/Announcement";

export const dynamic = "force-dynamic";

/** Deletes an announcement: the tuition may delete any, a teacher their own. */
export const DELETE = route<{ params: { id: string } }>(async (req, { params }) => {
  const session = await requireUser(req, "tuition", "teacher");
  if (!isObjectId(params.id)) throw notFound("This announcement");
  const announcement = await Announcement.findOne({ _id: params.id, tuitionId: session.tuitionId });
  if (!announcement) throw notFound("This announcement");
  if (session.role === "teacher" && String(announcement.authorId) !== session.userId) {
    throw new HttpError(403, "You can only delete your own announcements.");
  }
  await announcement.deleteOne();
  return { ok: true };
});
