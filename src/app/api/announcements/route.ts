import { Types } from "mongoose";
import { requireUser } from "@/lib/auth";
import { HttpError, isObjectId, oneOf, readJson, route, text } from "@/lib/http";
import { batchIdsOf } from "@/lib/members";
import Announcement, { ANNOUNCEMENT_KINDS, type AnnouncementDoc } from "@/models/Announcement";
import Batch from "@/models/Batch";
import User from "@/models/User";

export const dynamic = "force-dynamic";

async function out(list: AnnouncementDoc[], tuitionId: string) {
  const [authors, batches] = await Promise.all([
    User.find({ _id: { $in: list.map((a) => a.authorId) } }).select("name role").lean<{ _id: Types.ObjectId; name: string; role: string }[]>(),
    Batch.find({ tuitionId }).select("name").lean<{ _id: Types.ObjectId; name: string }[]>(),
  ]);
  return list.map((a) => {
    const author = authors.find((u) => String(u._id) === String(a.authorId));
    return {
      id: String(a._id),
      kind: a.kind,
      title: a.title,
      body: a.body,
      createdAt: a.createdAt,
      author: { id: String(a.authorId), name: author?.name ?? "Someone", role: author?.role ?? "" },
      batches: a.batchIds.map((id) => ({ id: String(id), name: batches.find((b) => String(b._id) === String(id))?.name ?? "" })),
      allBatches: a.batchIds.length === 0,
    };
  });
}

/**
 * Announcements the user should see, newest first: all of the tuition's for
 * its own account; for a teacher or student, those to the whole tuition or to
 * their batches. ?limit= (default 30, at most 100).
 */
export const GET = route(async (req) => {
  const session = await requireUser(req);
  const ids = await batchIdsOf(session);
  const filter: Record<string, unknown> = { tuitionId: session.tuitionId };
  if (ids !== "all") filter.$or = [{ batchIds: { $size: 0 } }, { batchIds: { $in: ids } }];
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 30, 1), 100);
  const list = (await Announcement.find(filter).sort({ createdAt: -1 }).limit(limit)) as AnnouncementDoc[];
  return { announcements: await out(list, session.tuitionId) };
});

/**
 * Posts an announcement. The tuition can send to every batch (no batchIds) or
 * some; a teacher only to batches they teach.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "tuition", "teacher");
  const body = await readJson(req);
  const raw = Array.isArray(body.batchIds) ? body.batchIds : [];
  if (!raw.every(isObjectId)) throw new HttpError(400, "Pick batches from the list.");
  const batchIds = [...new Set(raw as string[])];

  const allowed = await batchIdsOf(session);
  if (allowed === "all") {
    const found = await Batch.countDocuments({ _id: { $in: batchIds }, tuitionId: session.tuitionId });
    if (found !== batchIds.length) throw new HttpError(400, "Pick batches from the list.");
  } else {
    if (!batchIds.length) throw new HttpError(400, "Pick at least one of your batches.");
    if (!batchIds.every((id) => allowed.some((a) => String(a) === id))) {
      throw new HttpError(403, "You can only post to batches you teach.");
    }
  }

  const announcement = (await Announcement.create({
    tuitionId: session.tuitionId,
    batchIds,
    kind: body.kind === undefined ? "update" : oneOf(body, "kind", ANNOUNCEMENT_KINDS, "a kind"),
    title: text(body, "title", { required: true, max: 120, label: "a title" }),
    body: text(body, "body", { max: 2000 }) ?? "",
    authorId: session.user._id,
  })) as AnnouncementDoc;
  return { announcement: (await out([announcement], session.tuitionId))[0] };
});
