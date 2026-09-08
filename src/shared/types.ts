// Types used by the web app. Mirrors /shared/types.ts (kept in sync manually —
// this copy lets /web build standalone without reaching outside its own
// directory; /mobile still imports the original at /shared/types.ts).

export type ExamType = "JEE" | "NEET";

export type Subject =
  | "Physics"
  | "Chemistry"
  | "Mathematics"
  | "Biology"
  | "Botany"
  | "Zoology";

export type Section = "A" | "B";

export type AnswerType = "MCQ" | "Numerical" | "Bonus";

export type Difficulty = "Easy" | "Medium" | "Hard";

export type OptionKey = "A" | "B" | "C" | "D";

export interface SubjectBreakdown {
  subject: Subject;
  count: number;
}

export interface Paper {
  _id: string;
  title: string;
  examType: ExamType;
  year: number;
  subjects: Subject[];
  totalQuestions: number;
  pdfUrl: string;
  uploadedDate: string;
  subjectBreakdown?: SubjectBreakdown[];
}

export interface Question {
  _id: string;
  paperId: string;
  questionNumber: number;
  subject: Subject;
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
  diagramUrls?: string[];
  /** Figures printed inside the worked solution, shown with the explanation. */
  explanationDiagramUrls?: string[];
  /** Per-option diagrams, for questions whose choices are graphs/figures. */
  optionDiagramUrls?: Partial<Record<OptionKey, string[]>>;
}

// Question shape sent to the mobile app while an attempt is in progress — the
// correct answer, and the explanation that reveals it, are withheld until after
// submission. Diagrams stay, since they're part of the question itself.
export type QuestionForAttempt = Omit<
  Question,
  "correctAnswer" | "explanation" | "explanationDiagramUrls"
>;

export interface Student {
  _id: string;
  name: string;
  email: string;
  targetExam: ExamType;
  joinedDate: string;
}

export interface GivenAnswer {
  questionId: string;
  selected: OptionKey | string | null; // null/omitted = skipped
}

export interface AnsweredReview extends GivenAnswer {
  correctAnswer: string;
  isCorrect: boolean;
  isSkipped: boolean;
  marksAwarded: number;
  question: Question;
}

export interface Attempt {
  _id: string;
  studentId: string;
  paperId: string;
  answers: GivenAnswer[];
  score: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  totalQuestions: number;
  timeTaken: number; // seconds
  attemptedDate: string;
}

export interface AttemptResult extends Attempt {
  review: AnsweredReview[];
  paper?: Paper;
}

export interface DashboardStats {
  totalPapers: number;
  totalQuestions: number;
  totalAttempts: number;
  totalStudents: number;
  papersByExamType: { examType: ExamType; count: number }[];
}

// Marking scheme applied when scoring an attempt.
export const MARKING_SCHEME = {
  CORRECT: 4,
  WRONG: -1,
  SKIPPED: 0,
} as const;

export const SUBJECTS: Subject[] = [
  "Physics",
  "Chemistry",
  "Mathematics",
  "Biology",
  "Botany",
  "Zoology",
];
