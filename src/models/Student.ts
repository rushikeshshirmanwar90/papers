import { Schema, model, models, type Document } from "mongoose";
import type { ExamType } from "@shared/types";

export interface StudentDoc extends Document {
  name: string;
  email: string;
  targetExam: ExamType;
  joinedDate: Date;
}

const StudentSchema = new Schema<StudentDoc>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  targetExam: { type: String, enum: ["JEE", "NEET"], default: "JEE" },
  joinedDate: { type: Date, default: Date.now },
});

export default models.Student || model<StudentDoc>("Student", StudentSchema);
