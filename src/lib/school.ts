// What a tuition teaches: the tracks a student follows and their subjects.
// The pcmb-paper app mirrors these in src/constants/school.ts.

export const ROLES = ["tuition", "teacher", "student"] as const;
export type Role = (typeof ROLES)[number];

/** NEET = Physics, Chemistry, Biology; JEE = Physics, Chemistry, Maths; General = all four. */
export const TRACKS = ["NEET", "JEE", "General"] as const;
export type Track = (typeof TRACKS)[number];

export const SUBJECTS = ["Physics", "Chemistry", "Mathematics", "Biology"] as const;
export type SchoolSubject = (typeof SUBJECTS)[number];

export const SUBJECTS_BY_TRACK: Record<Track, SchoolSubject[]> = {
  NEET: ["Physics", "Chemistry", "Biology"],
  JEE: ["Physics", "Chemistry", "Mathematics"],
  General: ["Physics", "Chemistry", "Mathematics", "Biology"],
};

export const STANDARDS = ["11th", "12th"] as const;
export type SchoolStandard = (typeof STANDARDS)[number];

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const; // Sunday = 0

// ─── Academic programs ─────────────────────────────────────────────────────
//
// What a batch (and its students) prepares for. A program is separate from
// the question bank: only JEE and NEET have past-year questions today, and
// every other program has none rather than borrowing theirs. `track` is the
// older, coarser field still stored beside the program so older app versions
// keep working; a program always maps to one track.

export const PROGRAMS = ["JEE", "NEET", "MHT_CET_PCM", "MHT_CET_PCB", "HSC_SCIENCE", "GENERAL"] as const;
export type Program = (typeof PROGRAMS)[number];

/** The past-year question banks that exist. */
export const QUESTION_BANKS = ["JEE", "NEET"] as const;
export type QuestionBank = (typeof QUESTION_BANKS)[number];

export interface ProgramInfo {
  label: string;
  /** Picked by default for a new batch. */
  subjects: readonly SchoolSubject[];
  /** A batch may take any of these. */
  allowed: readonly SchoolSubject[];
  /** A batch must take all of these. */
  required: readonly SchoolSubject[];
  /** A batch must take at least one of these (empty: no such rule). */
  oneOf: readonly SchoolSubject[];
  /** The legacy track stored with it. */
  track: Track;
  /** Where its practice questions come from; null: none yet. */
  questionBank: QuestionBank | null;
}

const PCM: SchoolSubject[] = ["Physics", "Chemistry", "Mathematics"];
const PCB: SchoolSubject[] = ["Physics", "Chemistry", "Biology"];
const PCMB: SchoolSubject[] = ["Physics", "Chemistry", "Mathematics", "Biology"];

export const PROGRAM_INFO: Record<Program, ProgramInfo> = {
  JEE: { label: "JEE", subjects: PCM, allowed: PCM, required: [], oneOf: [], track: "JEE", questionBank: "JEE" },
  NEET: { label: "NEET", subjects: PCB, allowed: PCB, required: [], oneOf: [], track: "NEET", questionBank: "NEET" },
  MHT_CET_PCM: { label: "MHT-CET PCM", subjects: PCM, allowed: PCM, required: [], oneOf: [], track: "General", questionBank: null },
  MHT_CET_PCB: { label: "MHT-CET PCB", subjects: PCB, allowed: PCB, required: [], oneOf: [], track: "General", questionBank: null },
  // HSC Science: PCM, PCB or PCMB.
  HSC_SCIENCE: { label: "HSC Science", subjects: PCMB, allowed: PCMB, required: ["Physics", "Chemistry"], oneOf: ["Mathematics", "Biology"], track: "General", questionBank: null },
  GENERAL: { label: "General Tuition", subjects: PCMB, allowed: PCMB, required: [], oneOf: [], track: "General", questionBank: null },
};

/**
 * The programs new batches and newly enrolled students may have in this
 * release. Records of the other programs stay as they are and can still be
 * edited; they just can't be chosen for something new.
 */
export const OFFERED_PROGRAMS: readonly Program[] = ["JEE", "NEET"];
export const isOffered = (program: Program) => OFFERED_PROGRAMS.includes(program);
export const notOffered = (program: Program) =>
  `${PROGRAM_INFO[program].label} isn't offered yet. Choose ${OFFERED_PROGRAMS.map((p) => PROGRAM_INFO[p].label).join(" or ")}.`;

/** The program a legacy track stands for. */
export const programFromTrack = (track: Track): Program => (track === "JEE" ? "JEE" : track === "NEET" ? "NEET" : "GENERAL");

/** A batch's or student's program: the stored one, else its legacy track's; null when neither is set. */
export function programOf(x: { program?: Program | null; track?: Track | null }): Program | null {
  if (x.program && PROGRAM_INFO[x.program]) return x.program;
  return x.track ? programFromTrack(x.track) : null;
}

/** The question bank a program practises from; null for no program or one without a bank. */
export const questionBankOf = (program: Program | null): QuestionBank | null => (program ? PROGRAM_INFO[program].questionBank : null);

/** A student's subjects: their program's (every subject when they have none, as before). */
export const programSubjects = (program: Program | null): SchoolSubject[] => [...(program ? PROGRAM_INFO[program].subjects : SUBJECTS)];

/** Why these subjects don't suit the program, or null when they do. */
export function subjectProblem(program: Program, subjects: readonly SchoolSubject[]): string | null {
  const info = PROGRAM_INFO[program];
  if (!subjects.length) return "Pick at least one subject.";
  const outside = subjects.filter((s) => !info.allowed.includes(s));
  if (outside.length) return `${outside.join(", ")} isn't part of ${info.label}.`;
  const missing = info.required.filter((s) => !subjects.includes(s));
  if (missing.length) return `${info.label} batches take ${info.required.join(" and ")}.`;
  if (info.oneOf.length && !info.oneOf.some((s) => subjects.includes(s))) return `${info.label} batches also take ${info.oneOf.join(" or ")}.`;
  return null;
}

/** Why the student can't be in the batch (a different program or class), or null when they fit. */
export function fitProblem(
  student: { program?: Program | null; track?: Track | null; standard?: SchoolStandard | null },
  batch: { name: string; program?: Program | null; track?: Track | null; standard?: SchoolStandard | null }
): string | null {
  const mine = programOf(student);
  const theirs = programOf(batch);
  if (mine && theirs && mine !== theirs) {
    return `This student is in ${PROGRAM_INFO[mine].label}, but ${batch.name} is for ${PROGRAM_INFO[theirs].label}.`;
  }
  if (student.standard && batch.standard && student.standard !== batch.standard) {
    return `This student is in ${student.standard}, but ${batch.name} is for ${batch.standard}.`;
  }
  return null;
}

// ─── Academic year ─────────────────────────────────────────────────────────

/** New batches start in April (0-based month), after the 10th and 12th board exams. */
export const SESSION_START_MONTH = 3;

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The academic year in progress at `date` in India, e.g. "2026-2027". */
export function academicYearOf(date: Date = new Date()): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const start = ist.getUTCMonth() >= SESSION_START_MONTH ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${start + 1}`;
}

/** "2026-2027", "2026–2027" or "2026-27" as "2026-2027"; null when it isn't a year and the next. */
export function parseAcademicYear(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d{4})\s*[-–—/]\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2].length === 2 ? Math.floor(start / 100) * 100 + Number(match[2]) : Number(match[2]);
  if (start < 2000 || start > 2099 || end !== start + 1) return null;
  return `${start}-${end}`;
}
