import { Schema, model, models, type Document } from "mongoose";
import type { ExamType, Subject } from "@shared/types";

export interface PaperDoc extends Document {
  title: string;
  examType: ExamType;
  year: number;
  subjects: Subject[];
  totalQuestions: number;
  pdfUrl: string;
  uploadedDate: Date;
}

const PaperSchema = new Schema<PaperDoc>({
  title: { type: String, required: true, trim: true },
  examType: { type: String, enum: ["JEE", "NEET"], required: true },
  year: { type: Number, required: true },
  subjects: [
    {
      type: String,
      enum: ["Physics", "Chemistry", "Mathematics", "Biology", "Botany", "Zoology"],
    },
  ],
  totalQuestions: { type: Number, default: 0 },
  pdfUrl: { type: String, required: true },
  uploadedDate: { type: Date, default: Date.now },
});

export default models.Paper || model<PaperDoc>("Paper", PaperSchema);
