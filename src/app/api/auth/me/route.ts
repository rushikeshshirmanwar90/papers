import { publicUser, requireAccount } from "@/lib/auth";
import { readJson, route, text } from "@/lib/http";
import User from "@/models/User";

export const dynamic = "force-dynamic";

/** The signed-in user; the app calls it on start to check the saved login. */
export const GET = route(async (req) => {
  const { user } = await requireAccount(req);
  return { user: await publicUser(user) };
});

/** Edits the user's own basic details: name, phone, and a student's parent phone. */
export const PATCH = route(async (req) => {
  const { user } = await requireAccount(req);
  const body = await readJson(req);
  const changes: Record<string, string> = {};
  if (body.name !== undefined) changes.name = text(body, "name", { required: true, max: 100, label: "your name" })!;
  if (body.phone !== undefined) changes.phone = text(body, "phone", { max: 20, label: "a phone number" }) ?? "";
  if (body.parentPhone !== undefined && user.role === "student") {
    changes.parentPhone = text(body, "parentPhone", { max: 20, label: "a parent's phone number" }) ?? "";
  }
  const updated = await User.findByIdAndUpdate(user._id, changes, { returnDocument: "after", runValidators: true });
  return { user: await publicUser(updated!) };
});
