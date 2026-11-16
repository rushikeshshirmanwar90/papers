import { Schema, model, models, type Document } from "mongoose";
import { STANDARDS, SUBJECTS, type SchoolStandard, type SchoolSubject } from "@/lib/school";

export interface TopicItem {
  topicNumber?: string;
  name: string;
}

export interface ChapterItem {
  chapterNumber: number;
  name: string;
  code?: string;
  part?: number;
  pdfPath?: string;
  pages?: number;
  marks?: number;
  topics: (TopicItem | string)[];
}

export interface TextbookDoc extends Document {
  class: SchoolStandard;
  standard: SchoolStandard;
  subject: SchoolSubject;
  title: string;
  bookCodes?: string[];
  chapters: ChapterItem[];
  topics: string[];
  totalChapters?: number;
  totalTopics?: number;
  totalMarks?: number;
  createdAt: Date;
  updatedAt: Date;
}

const ChapterItemSchema = new Schema<ChapterItem>(
  {
    chapterNumber: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true },
    part: { type: Number, default: 1 },
    pdfPath: { type: String, trim: true },
    pages: { type: Number, default: 0 },
    marks: { type: Number, default: 5, min: 0, max: 100 },
    topics: [{ type: Schema.Types.Mixed }],
  },
  { _id: false }
);

const TextbookSchema = new Schema<TextbookDoc>(
  {
    class: { type: String, enum: STANDARDS, required: true },
    standard: { type: String, enum: STANDARDS, required: true },
    subject: { type: String, enum: SUBJECTS, required: true },
    title: { type: String, required: true, trim: true },
    bookCodes: [{ type: String, trim: true }],
    chapters: [ChapterItemSchema],
    topics: [{ type: String, trim: true }],
    totalChapters: { type: Number, default: 0 },
    totalTopics: { type: Number, default: 0 },
    totalMarks: { type: Number, default: 0 },
  },
  { timestamps: true }
);

TextbookSchema.index({ class: 1, subject: 1 }, { unique: true });
TextbookSchema.index({ standard: 1, subject: 1 });
TextbookSchema.index({ "chapters.name": 1 });
TextbookSchema.index({ topics: 1 });

export default models.Textbook || model<TextbookDoc>("Textbook", TextbookSchema);
