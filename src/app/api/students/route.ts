import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Student from "@/models/Student";

// Simple name+email "login" for the mobile app — finds an existing student
// by email or creates a new one. No password/auth, per the project spec.
export async function POST(req: NextRequest) {
  await connectDB();
  const { name, email, targetExam } = await req.json();

  if (!name || !email) {
    return NextResponse.json({ error: "name and email are required" }, { status: 400 });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  let student = await Student.findOne({ email: normalizedEmail });
  if (!student) {
    student = await Student.create({
      name: String(name).trim(),
      email: normalizedEmail,
      targetExam: targetExam === "NEET" ? "NEET" : "JEE",
    });
  }

  return NextResponse.json(student);
}

export async function GET() {
  await connectDB();
  const students = await Student.find().sort({ joinedDate: -1 }).lean();
  return NextResponse.json(students);
}
