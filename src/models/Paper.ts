import { Schema, model, models, type Document } from "mongoose";
import type { ExamCategory, ExamType, Standard, Subject, Difficulty } from "@shared/types";

export interface PaperDoc extends Document {
  title: string;
  examType: ExamType;
  examCategory?: ExamCategory;
  standard?: Standard;
  chapter?: string;
  topic?: string;
  difficulty?: Difficulty;
  year: number;
  subjects: Subject[];
  totalQuestions: number;
  pdfUrl: string;
  uploadedDate: Date;
}

const PaperSchema = new Schema<PaperDoc>({
  title: { type: String, required: true, trim: true },
  examType: { type: String, enum: ["JEE", "NEET"], required: true },
  examCategory: { type: String, enum: ["Foundation", "JEE/NEET"], default: "JEE/NEET" },
  standard: { type: String, enum: ["9th", "10th", "11th", "12th"], default: "11th" },
  chapter: { type: String, default: "" },
  topic: { type: String, default: "" },
  difficulty: { type: String, enum: ["Easy", "Medium", "Hard", "Mid"], default: "Medium" },
  year: { type: Number, required: true },
  subjects: [
    {
      type: String,
      enum: ["Physics", "Chemistry", "Mathematics", "Biology", "Botany", "Zoology", "Science"],
    },
  ],
  totalQuestions: { type: Number, default: 0 },
  pdfUrl: { type: String, required: true },
  uploadedDate: { type: Date, default: Date.now },
});

export default models.Paper || model<PaperDoc>("Paper", PaperSchema);
