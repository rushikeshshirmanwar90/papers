import { badRequest, oneOf } from "@/lib/http";
import {
  PROGRAM_INFO,
  programOf,
  programSubjects,
  questionBankOf,
  SUBJECTS,
  type Program,
  type QuestionBank,
  type SchoolSubject,
  type Track,
} from "@/lib/school";
import { BANK_SUBJECTS } from "@/lib/syllabus";
import { NOT_A_BANK_COPY } from "@/models/Question";

// Past-year questions: questions whose source names an exam and a year, e.g.
// "NEET 2019", "JEE MAIN 2020", "AIPMT 2014". They come from the question
// bank and from previous-year papers the extractor loads; a paper's copy of a
// question the bank already has is left out, so none is listed twice.
//
// Only the JEE and NEET banks exist. A student practises from their
// program's bank; programs without one (MHT-CET, HSC, General Tuition) get
// nothing, never another program's questions. There is no "any exam" bank.

const YEAR = "(19|20)\\d{2}";

/** Each bank: the exams that count as its past papers, and its subjects. */
const BANKS: Record<QuestionBank, { exams: string; subjects: readonly SchoolSubject[] }> = {
  NEET: { exams: "NEET|AIPMT|AIIMS|JIPMER", subjects: PROGRAM_INFO.NEET.allowed },
  JEE: { exams: "JEE|AIEEE|IIT|BITSAT", subjects: PROGRAM_INFO.JEE.allowed },
};

/** The Mongo filter for a bank's PYQs in some bank subjects. */
function bankFilter(bank: QuestionBank, bankSubjects: string[]): Record<string, unknown> {
  const { exams } = BANKS[bank];
  return {
    ...NOT_A_BANK_COPY,
    examCategory: "JEE/NEET",
    subject: { $in: bankSubjects },
    answerType: { $in: ["MCQ", "Numerical"] },
    source: { $regex: `(${exams}).*${YEAR}|${YEAR}.*(${exams})`, $options: "i" },
  };
}

/** The Mongo filter for a bank's PYQs in a subject (and chapter). */
export function pyqFilter(bank: QuestionBank, subject: SchoolSubject, chapter?: string | null) {
  const filter = bankFilter(bank, BANK_SUBJECTS[subject]);
  if (chapter) filter.chapter = chapter;
  return filter;
}

/** Every PYQ of the bank's subjects: the questions a student of that bank may practise. */
export const pyqBankFilter = (bank: QuestionBank) => bankFilter(bank, BANKS[bank].subjects.flatMap((s) => BANK_SUBJECTS[s]));

type Practiser = { program?: Program | null; track?: Track | null };

/** The bank a user practises from, or null: their program has none (or they have no program). */
export const practiceBankOf = (user: Practiser): QuestionBank | null => questionBankOf(programOf(user));

/** The subject from ?subject=, checked against the user's program. */
export function readSubject(value: string | null, user: Practiser): SchoolSubject {
  const subject = oneOf({ subject: value }, "subject", SUBJECTS, "a subject");
  const program = programOf(user);
  if (!programSubjects(program).includes(subject)) throw badRequest(`${subject} isn't part of ${program ? PROGRAM_INFO[program].label : "your subjects"}.`);
  return subject;
}
