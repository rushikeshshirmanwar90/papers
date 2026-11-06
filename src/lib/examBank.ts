// The exams the question bank holds questions for, and how a question is
// told to belong to one.
//
// Every JEE and NEET question is stored under examCategory "JEE/NEET"; the
// exam it was asked in only shows in its `source` ("JEE MAIN 2020",
// "NEET 2019", "AIPMT 2014"). So an exam is picked out by the exam names in
// the source, the same names past-year practice uses (lib/pyq.ts). Nothing
// else (MHT-CET, HSC, Foundation, custom) has a bank, and none borrows
// another's questions.
//
// The same file is papers/src/lib/examBank.ts (the server) and
// pcmb-paper/src/shared/exam-bank.ts (the app's Make PDF flow). Change both
// together; the app's test checks they match.
// Plain TypeScript with no imports, so both projects can run it as is.

export const EXAM_IDS = ["JEE", "NEET"] as const;
export type ExamId = (typeof EXAM_IDS)[number];

export interface ExamInfo {
  label: string;
  /** The subjects of the exam: Biology is NEET's, Mathematics JEE's. */
  subjects: readonly string[];
  /** Exam names a question's source carries, as regular-expression alternatives. */
  sources: string;
}

export const EXAMS: Record<ExamId, ExamInfo> = {
  JEE: { label: "JEE", subjects: ["Physics", "Chemistry", "Mathematics"], sources: "JEE|AIEEE|IIT|BITSAT" },
  NEET: { label: "NEET", subjects: ["Physics", "Chemistry", "Biology"], sources: "NEET|AIPMT|AIIMS|JIPMER" },
};

export const isExamId = (value: unknown): value is ExamId => typeof value === "string" && (EXAM_IDS as readonly string[]).includes(value);

/** The regular expression (case-insensitive) a source must match to belong to the exam. */
export const examSourcePattern = (exam: ExamId) => `(${EXAMS[exam].sources})`;

/** Whether a question's source names the exam. A question with no source names none. */
export const sourceMatchesExam = (source: string | null | undefined, exam: ExamId) =>
  new RegExp(examSourcePattern(exam), "i").test(source ?? "");

/** Why the subject isn't part of the exam, or null when it is. */
export const examSubjectProblem = (exam: ExamId, subject: string) =>
  EXAMS[exam].subjects.includes(subject) ? null : `${subject} isn't part of ${EXAMS[exam].label}.`;
