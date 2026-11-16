import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Tuition from "@/models/Tuition";
import User from "@/models/User";
import Batch from "@/models/Batch";

// Counts change as tuitions are added/changed; never serve a stale snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  await connectDB();

  const [totalTuitions, activeTuitions, totalTeachers, totalStudentsInTuitions, totalBatches] = await Promise.all([
    Tuition.countDocuments(),
    Tuition.countDocuments({ active: true }),
    User.countDocuments({ role: "teacher" }),
    User.countDocuments({ role: "student", accountStatus: { $ne: "invited" } }),
    Batch.countDocuments(),
  ]);

  return NextResponse.json({
    totalTuitions,
    activeTuitions,
    totalTeachers,
    totalStudentsInTuitions,
    totalBatches,
  });
}
