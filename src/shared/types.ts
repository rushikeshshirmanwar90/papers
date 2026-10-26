// Types used by the web app. Mirrors /shared/types.ts (kept in sync manually —
// this copy lets /web build standalone without reaching outside its own
// directory; /mobile still imports the original at /shared/types.ts).

export type ExamType = "JEE" | "NEET" | "Foundation";

export type ExamCategory = "Foundation" | "JEE/NEET";

export type Standard = "9th" | "10th" | "11th" | "12th";

export type Subject =
  | "Physics"
  | "Chemistry"
  | "Mathematics"
  | "Biology"
  | "Botany"
  | "Zoology"
  | "Science";

export type Section = "A" | "B";

// "Descriptive": a written-answer question with no options or answer key;
// its worked answer is the explanation. Never part of a scored attempt.
export type AnswerType = "MCQ" | "Numerical" | "Bonus" | "Descriptive";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Mid";

export type OptionKey = "A" | "B" | "C" | "D";

export interface SubjectBreakdown {
  subject: Subject;
  count: number;
}

export interface Paper {
  _id: string;
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
  uploadedDate: string;
  subjectBreakdown?: SubjectBreakdown[];
}

export interface Question {
  _id: string;
  paperId: string;
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
  /** Where the question was originally set, e.g. "JEE Main 2019". */
  source?: string;
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

export interface DashboardStats {
  totalPapers: number;
  totalQuestions: number;
  totalAttempts: number;
  totalStudents: number;
  papersByExamType: { examType: ExamType; count: number }[];
}

export const SUBJECTS: Subject[] = [
  "Physics",
  "Chemistry",
  "Mathematics",
  "Biology",
  "Botany",
  "Zoology",
];