import { Schema, model, models, Types, type Document } from "mongoose";
import type { AnswerType, Difficulty, ExamCategory, Section, Standard, Subject } from "@shared/types";

export interface QuestionDoc extends Document {
  paperId: Types.ObjectId;
  questionNumber: number;
  subject: Subject;
  examCategory?: ExamCategory;
  standard?: Standard;
  chapter?: string;
  topic?: string;
  section: Section;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  answerType: AnswerType;
  difficulty: Difficulty;
  explanation?: string;
  source?: string;
  diagramUrls?: string[];
  explanationDiagramUrls?: string[];
  optionDiagramUrls?: { A: string[]; B: string[]; C: string[]; D: string[] };
}

const QuestionSchema = new Schema<QuestionDoc>({
  paperId: { type: Schema.Types.ObjectId, ref: "Paper", required: true, index: true },
  questionNumber: { type: Number, required: true },
  subject: {
    type: String,
    enum: ["Physics", "Chemistry", "Mathematics", "Biology", "Botany", "Zoology", "Science"],
    required: true,
  },
  examCategory: { type: String, enum: ["Foundation", "JEE/NEET"], default: "JEE/NEET" },
  standard: { type: String, enum: ["9th", "10th", "11th", "12th"], default: "11th" },
  chapter: { type: String, default: "" },
  topic: { type: String, default: "" },
  section: { type: String, enum: ["A", "B"], default: "A" },
  questionText: { type: String, required: true },
  optionA: { type: String, default: "" },
  optionB: { type: String, default: "" },
  optionC: { type: String, default: "" },
  optionD: { type: String, default: "" },
  correctAnswer: { type: String, default: "" },
  answerType: { type: String, enum: ["MCQ", "Numerical", "Bonus"], default: "MCQ" },
  difficulty: { type: String, enum: ["Easy", "Medium", "Hard", "Mid"], default: "Medium" },
  explanation: { type: String, default: "" },
  source: { type: String, default: "" },
  diagramUrls: { type: [String], default: [] },
  explanationDiagramUrls: { type: [String], default: [] },
  optionDiagramUrls: {
    type: new Schema(
      {
        A: { type: [String], default: [] },
        B: { type: [String], default: [] },
        C: { type: [String], default: [] },
        D: { type: [String], default: [] },
      },
      { _id: false }
    ),
    default: () => ({ A: [], B: [], C: [], D: [] }),
  },
});

export default models.Question || model<QuestionDoc>("Question", QuestionSchema);
