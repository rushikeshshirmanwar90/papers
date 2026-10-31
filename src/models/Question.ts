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
  /** The question's id on Vedclass, set by the extractor. */
  vedclassId?: number;
  /** Part of a previous-year paper loaded by the extractor (extractor/pyq_jobs.py). */
  pyqPaper?: boolean;
  /**
   * A previous-year paper's copy of a question the bank already has. It shows
   * in its paper but not in bank-wide lists (PYQ practice, search, filters,
   * syllabus), so those never list the same question twice.
   */
  bankCopy?: boolean;
}

const QuestionSchema = new Schema<QuestionDoc>({
  paperId: { type: Schema.Types.ObjectId, ref: "Paper", required: true },
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
  answerType: { type: String, enum: ["MCQ", "Numerical", "Bonus", "Descriptive"], default: "MCQ" },
  difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
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
  vedclassId: { type: Number },
  pyqPaper: { type: Boolean },
  bankCopy: { type: Boolean },
});

/** Leaves out previous-year papers' copies of bank questions; see bankCopy. */
export const NOT_A_BANK_COPY = { bankCopy: { $ne: true } } as const;

// A paper's questions in order; per-paper subject counts (/api/papers) read
// straight from the index; the filters the apps search by; a question's
// Vedclass id. The Vedclass extractor (extractor/papers_db.py) creates the
// same four.
QuestionSchema.index({ paperId: 1, questionNumber: 1 });
QuestionSchema.index({ paperId: 1, subject: 1 });
QuestionSchema.index({ standard: 1, subject: 1, chapter: 1, topic: 1 });
QuestionSchema.index({ vedclassId: 1 }, { sparse: true });

export default models.Question || model<QuestionDoc>("Question", QuestionSchema);
