import type { Types } from "mongoose";
import NotificationLog from "@/models/NotificationLog";
import User from "@/models/User";

// Phone notifications through Expo's push service. Sending never fails the
// request that triggered it: problems are logged and the request goes on.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

export const isPushToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value);

export interface PushMessage {
  title: string;
  body: string;
  /** Read by the app when the notification is tapped, e.g. { tab: "tests" }. */
  data?: Record<string, string>;
}

/** Sends the message to every phone of these users. */
export async function pushToUsers(userIds: (Types.ObjectId | string)[], message: PushMessage) {
  if (!userIds.length) return;
  try {
    const users = await User.find({ _id: { $in: userIds }, active: true }).select("+pushTokens").lean<{ pushTokens?: { token: string }[] }[]>();
    const tokens = [...new Set(users.flatMap((u) => (u.pushTokens ?? []).map((t) => t.token)).filter(isPushToken))];
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch.map((to) => ({ to, title: message.title, body: message.body, data: message.data ?? {}, sound: "default", channelId: "default" }))),
        signal: AbortSignal.timeout(8000),
      });
      const result = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
      // Forget phones the app was removed from.
      const gone = (result?.data ?? []).map((r, j) => (r.details?.error === "DeviceNotRegistered" ? batch[j] : null)).filter(Boolean) as string[];
      if (gone.length) await User.updateMany({ "pushTokens.token": { $in: gone } }, { $pull: { pushTokens: { token: { $in: gone } } } });
    }
  } catch (error) {
    console.error("[push] sending failed:", error);
  }
}

/** Like pushToUsers, but at most once per key (until the log entry expires). */
export async function pushOnce(key: string, userIds: (Types.ObjectId | string)[], message: PushMessage) {
  try {
    await NotificationLog.create({ key, sentAt: new Date() });
  } catch {
    return; // Already sent for this key.
  }
  await pushToUsers(userIds, message);
}

/** Everyone of the tuition in these batches (or all batches), by role. */
export async function membersOf(tuitionId: string, batchIds: (Types.ObjectId | string)[] | "all", roles: ("teacher" | "student")[]) {
  const or: Record<string, unknown>[] = [];
  if (roles.includes("student")) or.push(batchIds === "all" ? { role: "student" } : { role: "student", batchId: { $in: batchIds } });
  if (roles.includes("teacher")) {
    if (batchIds === "all") or.push({ role: "teacher" });
    else {
      const { default: Batch } = await import("@/models/Batch");
      const batches = await Batch.find({ _id: { $in: batchIds } }).select("teachers").lean<{ teachers: { teacherId: Types.ObjectId }[] }[]>();
      or.push({ role: "teacher", _id: { $in: batches.flatMap((b) => b.teachers.map((t) => t.teacherId)) } });
    }
  }
  if (!or.length) return [];
  const users = await User.find({ tuitionId, $or: or }).select("_id").lean<{ _id: Types.ObjectId }[]>();
  return users.map((u) => u._id);
}
