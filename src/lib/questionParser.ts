import type { AnswerType, Section, Subject } from "@shared/types";

export interface ParsedQuestion {
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
}

export interface ParseResult {
  questions: ParsedQuestion[];
  subjectsFound: Subject[];
}

const SUBJECT_LIST: Subject[] = [
  "Physics",
  "Chemistry",
  "Mathematics",
  "Biology",
  "Botany",
  "Zoology",
];

export function matchSubjectHeader(line: string): Subject | null {
  const cleaned = line.replace(/[^a-zA-Z\s]/g, "").trim();
  if (!cleaned) return null;

  for (const subject of SUBJECT_LIST) {
    if (cleaned.toLowerCase() === subject.toLowerCase()) return subject;
  }
  // Allow a subject name combined with other short header text on the same
  // line, e.g. "PHYSICS SECTION - A", as long as it starts with the subject.
  for (const subject of SUBJECT_LIST) {
    const re = new RegExp(`^${subject}\\b`, "i");
    if (re.test(cleaned) && cleaned.length <= subject.length + 20) return subject;
  }
  return null;
}

type ActiveField = "text" | "A" | "B" | "C" | "D" | undefined;

interface DraftQuestion {
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
  activeField: ActiveField;
}

const OPTION_FIELD: Record<"A" | "B" | "C" | "D", "optionA" | "optionB" | "optionC" | "optionD"> = {
  A: "optionA",
  B: "optionB",
  C: "optionC",
  D: "optionD",
};

export function parseQuestionsFromLines(lines: string[]): ParseResult {
  const subjectsFound = new Set<Subject>();
  const questions: ParsedQuestion[] = [];

  let currentSubject: Subject = "Physics";
  let currentSection: Section = "A";
  let current: DraftQuestion | null = null;

  const flush = () => {
    if (current) {
      questions.push({
        questionNumber: current.questionNumber,
        subject: current.subject,
        section: current.section,
        questionText: current.questionText.trim(),
        optionA: current.optionA.trim(),
        optionB: current.optionB.trim(),
        optionC: current.optionC.trim(),
        optionD: current.optionD.trim(),
        correctAnswer: current.correctAnswer,
        answerType: current.answerType,
      });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const subjectMatch = matchSubjectHeader(line);
    if (subjectMatch) {
      currentSubject = subjectMatch;
      subjectsFound.add(subjectMatch);
      continue;
    }

    const sectionMatch = line.match(/section\s*-?\s*([ab])\b/i);
    if (sectionMatch && line.length < 30) {
      currentSection = sectionMatch[1].toUpperCase() as Section;
      continue;
    }

    const questionMatch = line.match(/^(\d{1,3})\.\s+(.*)/);
    if (questionMatch) {
      flush();
      current = {
        questionNumber: parseInt(questionMatch[1], 10),
        subject: currentSubject,
        section: currentSection,
        questionText: questionMatch[2],
        optionA: "",
        optionB: "",
        optionC: "",
        optionD: "",
        correctAnswer: "",
        answerType: "MCQ",
        activeField: "text",
      };
      continue;
    }

    const optionMatch = line.match(/^\(([A-Da-d])\)\s*(.*)/);
    if (optionMatch && current) {
      const key = optionMatch[1].toUpperCase() as "A" | "B" | "C" | "D";
      current[OPTION_FIELD[key]] = optionMatch[2];
      current.activeField = key;
      continue;
    }

    const answerMatch = line.match(/ans\.?\s*\[\s*([^\]]+?)\s*\]/i);
    if (answerMatch && current) {
      const value = answerMatch[1].trim();
      const isBonus = /^bonus$/i.test(value);
      const isOption = /^[a-d]$/i.test(value);
      current.correctAnswer = isBonus ? "Bonus" : isOption ? value.toUpperCase() : value;
      current.answerType = isBonus ? "Bonus" : isOption ? "MCQ" : "Numerical";
      current.activeField = undefined;
      flush();
      continue;
    }

    // Continuation of the previous marker (question/option text wraps lines).
    if (current && current.activeField) {
      if (current.activeField === "text") {
        current.questionText += " " + line;
      } else {
        const field = OPTION_FIELD[current.activeField];
        current[field] = (current[field] + " " + line).trim();
      }
    }
  }
  flush();

  return { questions, subjectsFound: Array.from(subjectsFound) };
}
