import { Types } from "mongoose";
import { requireAdmin } from "@/lib/admin";
import { route } from "@/lib/http";
import { ROLES } from "@/lib/school";
import Tuition from "@/models/Tuition";
import User from "@/models/User";

export const dynamic = "force-dynamic";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds anyone across all tuitions, for support: ?q= (name, email or phone),
 * ?role=. At most 50, recently active first.
 */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const params = req.nextUrl.searchParams;
  const q = params.get("q")?.trim().slice(0, 60) ?? "";
  const role = params.get("role");
  const filter: Record<string, unknown> = {};
  if (q) {
    const re = new RegExp(escape(q), "i");
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  if (role && (ROLES as readonly string[]).includes(role)) filter.role = role;
  const users = await User.find(filter)
    .select("name email phone role active lastLoginAt tuitionId createdAt +lockedUntil")
    .sort({ lastLoginAt: -1, createdAt: -1 })
    .limit(50)
    .lean<{ _id: Types.ObjectId; name: string; email: string; phone: string; role: string; active: boolean; lastLoginAt: Date | null; tuitionId: Types.ObjectId; createdAt: Date; lockedUntil?: Date | null }[]>();
  const tuitions = await Tuition.find({ _id: { $in: users.map((u) => u.tuitionId) } }).select("name active").lean<{ _id: Types.ObjectId; name: string; active: boolean }[]>();
  return {
    users: users.map((u) => {
      const t = tuitions.find((x) => String(x._id) === String(u.tuitionId));
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        active: u.active,
        locked: !!u.lockedUntil && u.lockedUntil > new Date(),
        lastLoginAt: u.lastLoginAt,
        tuition: { id: String(u.tuitionId), name: t?.name ?? "", active: t?.active ?? false },
      };
    }),
  };
});
