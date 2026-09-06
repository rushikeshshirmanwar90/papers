// Fallback parser for coaching-institute exam PDFs that don't follow the strict
// "1. / (A) / Ans. [X]" single-column layout that questionParser.ts handles.
//
// It is deliberately tolerant about the surface syntax, because every institute
// formats these differently. Across the sample papers we've seen:
//   numbering      "1."      "1)"      "(1)"
//   options        "(A) x"   "A ) x"   several options sharing one line
//   answer key     "1 C 2 A" "1 - D 2 - D"   under "Answer Sheet"/"(Answer Key)"
//   explanations   "Solution Sheet" / "(Solutions)" sections, the latter also
//                  carrying an inline "Solution:(Correct Answer:D)" per question
//
// extractStructuredPdf() supplies a reading-order event stream with embedded
// diagram images inline, so images land on the question, the individual option,
// or the explanation they were printed next to.
import type { AnswerType, Section, Subject } from "@shared/types";
import { matchSubjectHeader } from "./questionParser";
import type { PdfEvent, TextFragment } from "./pdfStructured";

type OptionKey = "A" | "B" | "C" | "D";
const OPTION_ORDER: OptionKey[] = ["A", "B", "C", "D"];

export interface CoachingQuestion {
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
  explanation: string;
  /** Diagrams printed as part of the question stem. */
  diagrams: Buffer[];
  /** Diagrams printed as an option's content (graph-choice questions). */
  optionDiagrams: Record<OptionKey, Buffer[]>;
  /** Diagrams printed inside the worked explanation. */
  explanationDiagrams: Buffer[];
}

export interface CoachingParseResult {
  questions: CoachingQuestion[];
  subjectsFound: Subject[];
}

interface QuestionDraft {
  n: number;
  subject: Subject;
  section: Section;
  text: string;
  options: Record<OptionKey, string>;
  optionDiagrams: Record<OptionKey, Buffer[]>;
  diagrams: Buffer[];
  active: "text" | OptionKey;
  lastOption: OptionKey | null;
  /** x position each option's content starts at, learned from its marker row. */
  columns: Partial<Record<OptionKey, number>>;
  /** Unlabelled rows seen since the last marker row — possible numerators. */
  pending: { text: string; fragments: TextFragment[] }[];
}

interface SolutionDraft {
  n: number;
  answer: string;
  lines: string[];
  diagrams: Buffer[];
  capturing: boolean; // only true once the "Solution:" marker is seen
}

/**
 * Assigns each fragment of an unlabelled row to the option whose column it sits
 * in. Options are laid out in a grid, so a stacked fraction's numerator and
 * denominator line up horizontally with their own option's marker even though
 * they occupy separate rows.
 *
 * Returns null when the row doesn't look like it belongs to the option grid —
 * either no columns are known yet, or the fragments don't line up with them.
 */
function distributeByColumn(
  fragments: TextFragment[],
  columns: Partial<Record<OptionKey, number>>
): Partial<Record<OptionKey, string>> | null {
  const entries = (Object.entries(columns) as [OptionKey, number][]).filter(([, x]) => x !== undefined);
  if (entries.length < 2 || fragments.length === 0) return null;

  const TOLERANCE = 26; // generous: fraction bars sit slightly off their marker
  const result: Partial<Record<OptionKey, string>> = {};
  for (const frag of fragments) {
    let bestKey: OptionKey | null = null;
    let bestDist = Infinity;
    for (const [key, x] of entries) {
      const dist = Math.abs(frag.x - x);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }
    if (bestKey === null || bestDist > TOLERANCE) return null;
    result[bestKey] = (result[bestKey] ? result[bestKey] + " " : "") + frag.text;
  }
  return result;
}

/**
 * Decides whether the row sitting directly above the option markers really is
 * the numerators of stacked fractions, rather than the tail of the question
 * wrapping off the end of the line.
 *
 * Position alone is not enough to tell them apart: a question ending in
 * "(in , m )?" leaves "m )?" on its own row, which can land close enough to an
 * option's column to look like content. Claiming it would both truncate the
 * question and prepend junk to option A, so a row has to actually look the
 * part — mostly symbols, no sentence punctuation, and split across at least
 * two options, the way a genuine "18   8" numerator row is.
 */
function looksLikeStackedNumerators(
  text: string,
  spread: Partial<Record<OptionKey, string>>
): boolean {
  if (text.includes("?")) return false;
  if (Object.values(spread).filter(Boolean).length < 2) return false;
  const compact = text.replace(/\s/g, "");
  if (!compact) return false;
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  return letters / compact.length <= 0.4;
}

const emptyOptions = (): Record<OptionKey, string> => ({ A: "", B: "", C: "", D: "" });
const emptyOptionDiagrams = (): Record<OptionKey, Buffer[]> => ({ A: [], B: [], C: [], D: [] });

// Matches "1." / "1)" / "(1)" at the start of a line, capturing which of those
// three styles was used.
const QUESTION_RE = /^(\()?\s*(\d{1,3})\s*([.)])\s*(.*)$/;

type NumberStyle = "paren" | "bracketed" | "dot";

interface NumberedLine {
  n: number;
  rest: string;
  style: NumberStyle;
}

function matchNumberedLine(line: string): NumberedLine | null {
  const m = line.match(QUESTION_RE);
  if (!m) return null;
  const [, open, digits, close, rest] = m;
  const text = rest ?? "";
  // "(280) × ( sin 30 )" is a chunk of a formula, not question 280. A real
  // question number is followed by prose, never by an operator.
  if (/^[×x*+\-−=/÷·^]/.test(text.trim())) return null;
  const style: NumberStyle = open ? "paren" : close === ")" ? "bracketed" : "dot";
  return { n: parseInt(digits, 10), rest: text, style };
}
// Matches "(A)" / "A)" / "A )" anywhere in a line.
const OPTION_RE = /\(?\b([A-Da-d])\s*\)/g;
const ANSWER_PAIR_RE = /\b(\d{1,3})\s*[-–—:.]?\s*([A-Da-d])\b/g;
const INLINE_ANSWER_RE = /correct\s*answer\s*[:\-]?\s*\(?\s*([A-Da-d])\s*\)?/i;

// Repeated running-header/footer boilerplate (institute name, "Total Marks : N")
// appears verbatim many times; filter it generically rather than hardcoding any
// particular institute's letterhead.
function findBoilerplateLines(events: PdfEvent[]): Set<string> {
  const freq = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind !== "text") continue;
    const trimmed = ev.value.trim();
    const norm = trimmed.toLowerCase();
    if (!norm || norm.length > 40) continue;
    if (!isFilterableAsBoilerplate(trimmed)) continue;
    freq.set(norm, (freq.get(norm) ?? 0) + 1);
  }
  const boilerplate = new Set<string>();
  for (const [line, count] of freq) if (count >= 3) boilerplate.add(line);
  return boilerplate;
}

/**
 * Guards the running-header heuristic against eating real content. Repetition
 * alone is a bad signal in a maths paper: an options row whose values are
 * stacked fractions renders as a bare "(A) (B)", and fragments like "5 5"
 * recur constantly. Only prose-looking lines carrying no structural marker are
 * ever eligible.
 */
function isFilterableAsBoilerplate(line: string): boolean {
  if (INLINE_ANSWER_RE.test(line)) return false;
  if (matchNumberedLine(line)) return false;
  OPTION_RE.lastIndex = 0;
  if (OPTION_RE.test(line)) return false;
  const letters = line.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3;
}

/**
 * Indices of text events sitting at the very top or bottom of a page, where
 * standalone page numbers live. Used to drop those without also dropping a
 * bare "3" that is really a fraction's denominator mid-column.
 */
function findPageEdgeIndices(events: PdfEvent[]): Set<number> {
  const edges = new Set<number>();
  let firstOfPage: number | null = null;
  let lastOfPage: number | null = null;
  const closePage = () => {
    if (firstOfPage !== null) edges.add(firstOfPage);
    if (lastOfPage !== null) edges.add(lastOfPage);
    firstOfPage = null;
    lastOfPage = null;
  };
  events.forEach((ev, i) => {
    if (ev.kind === "pagebreak") closePage();
    else if (ev.kind === "text") {
      if (firstOfPage === null) firstOfPage = i;
      lastOfPage = i;
    }
  });
  closePage();
  return edges;
}

/**
 * Finds option markers in a line, accepting only those that continue the
 * A→B→C→D sequence. Without that guard, incidental text such as the "( A )"
 * row labels of a match-the-columns table, or the "2)" inside "x = 4(t − 2)",
 * would be mistaken for real options.
 */
function findOptionMarkers(line: string, lastOption: OptionKey | null) {
  const found: { letter: OptionKey; start: number; contentStart: number }[] = [];
  let expectedIndex = lastOption === null ? 0 : OPTION_ORDER.indexOf(lastOption) + 1;
  OPTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPTION_RE.exec(line)) !== null) {
    const letter = m[1].toUpperCase() as OptionKey;
    if (expectedIndex >= OPTION_ORDER.length || letter !== OPTION_ORDER[expectedIndex]) continue;
    found.push({ letter, start: m.index, contentStart: m.index + m[0].length });
    expectedIndex++;
  }
  return found;
}

export function parseCoachingPaper(events: PdfEvent[]): CoachingParseResult {
  const boilerplate = findBoilerplateLines(events);
  const pageEdges = findPageEdgeIndices(events);
  const subjectsFound = new Set<Subject>();

  let currentSubject: Subject = "Physics";
  let currentSection: Section = "A";
  let phase: "questions" | "answers" | "solutions" = "questions";
  let numberStyle: NumberStyle | null = null;
  let maxQuestionNumber = 0;

  const qDrafts: QuestionDraft[] = [];
  let qDraft: QuestionDraft | null = null;
  const solDrafts = new Map<number, SolutionDraft>();
  let solDraft: SolutionDraft | null = null;
  const answerMap = new Map<number, string>();

  const flushQ = () => {
    if (qDraft) qDrafts.push(qDraft);
    qDraft = null;
  };
  const flushSol = () => {
    if (solDraft) solDrafts.set(solDraft.n, solDraft);
    solDraft = null;
  };

  const appendToActive = (draft: QuestionDraft, text: string) => {
    if (draft.active === "text") draft.text += (draft.text ? " " : "") + text;
    else draft.options[draft.active] += (draft.options[draft.active] ? " " : "") + text;
  };

  for (let evIndex = 0; evIndex < events.length; evIndex++) {
    const ev = events[evIndex];
    if (ev.kind === "pagebreak") continue;

    if (ev.kind === "image") {
      if (phase === "solutions" && solDraft) solDraft.diagrams.push(ev.buffer);
      else if (phase === "questions" && qDraft) {
        // Graph-choice questions print the option's content as the image, so
        // attach it to whichever option we're currently inside.
        if (qDraft.active === "text") qDraft.diagrams.push(ev.buffer);
        else qDraft.optionDiagrams[qDraft.active].push(ev.buffer);
      }
      continue;
    }

    const raw = ev.value.trim();
    if (!raw) continue;
    if (raw.length <= 40 && boilerplate.has(raw.toLowerCase())) continue;
    // Standalone page number at the top/bottom of a page.
    if (/^\d{1,3}$/.test(raw) && pageEdges.has(evIndex)) continue;

    if (/^\(?\s*answer\s*(key|sheet)\s*\)?$/i.test(raw)) {
      flushQ();
      flushSol();
      phase = "answers";
      continue;
    }
    if (/^\(?\s*solutions?\s*(sheet)?\s*\)?$/i.test(raw)) {
      flushQ();
      flushSol();
      phase = "solutions";
      continue;
    }

    if (phase === "answers") {
      ANSWER_PAIR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ANSWER_PAIR_RE.exec(raw)) !== null) {
        answerMap.set(parseInt(m[1], 10), m[2].toUpperCase());
      }
      continue;
    }

    if (phase === "solutions") {
      const numbered = matchNumberedLine(raw);
      // Solution blocks restate the question, so a number that doesn't advance
      // is ordinary text, not a new block. The style check matters just as much:
      // worked explanations are written as numbered steps ("2 . Velocity at
      // ..."), which would otherwise look like the start of question 2.
      // A solution can only restate a question that actually exists, so a
      // number beyond the paper's last question is something else entirely.
      // Without this, one stray high number poisons the monotonic check and
      // every later solution is silently dropped.
      const plausible = maxQuestionNumber === 0 || numbered === null || numbered.n <= maxQuestionNumber;
      if (
        numbered &&
        plausible &&
        numbered.style === numberStyle &&
        (!solDraft || numbered.n > solDraft.n)
      ) {
        flushSol();
        solDraft = { n: numbered.n, answer: "", lines: [], diagrams: [], capturing: false };
        continue;
      }
      if (!solDraft) continue;

      const inline = raw.match(INLINE_ANSWER_RE);
      if (inline) {
        solDraft.answer = inline[1].toUpperCase();
        solDraft.capturing = true;
        // Keep any explanation text that trails the marker on the same line.
        const trailing = raw.slice((inline.index ?? 0) + inline[0].length).replace(/^[)\s:.-]+/, "").trim();
        if (trailing) solDraft.lines.push(trailing);
        continue;
      }
      // Everything before the marker is the restated question/options; only
      // what follows it is the worked explanation.
      if (solDraft.capturing) solDraft.lines.push(raw);
      continue;
    }

    // ---- questions phase ----
    const subjectMatch = matchSubjectHeader(raw);
    if (subjectMatch) {
      currentSubject = subjectMatch;
      subjectsFound.add(subjectMatch);
      continue;
    }
    const sectionMatch = raw.match(/section\s*-?\s*([ab])\b/i);
    if (sectionMatch && raw.length < 60) {
      currentSection = sectionMatch[1].toUpperCase() as Section;
      if (!qDraft) continue;
    }

    const numbered = matchNumberedLine(raw);
    // The first question fixes the paper's numbering style; later lines must
    // match it, so a stray "2)" from an expression like "x = 4(t − 2)" can't
    // masquerade as the next question.
    if (
      numbered &&
      (numberStyle === null || numbered.style === numberStyle) &&
      (!qDraft || numbered.n > qDraft.n)
    ) {
      numberStyle ??= numbered.style;
      maxQuestionNumber = Math.max(maxQuestionNumber, numbered.n);
      flushQ();
      qDraft = {
        n: numbered.n,
        subject: currentSubject,
        section: currentSection,
        text: numbered.rest,
        options: emptyOptions(),
        optionDiagrams: emptyOptionDiagrams(),
        diagrams: [],
        active: "text",
        lastOption: null,
        columns: {},
        pending: [],
      };
      continue;
    }
    if (!qDraft) continue;

    const markers = findOptionMarkers(raw, qDraft.lastOption);
    if (markers.length > 0) {
      const preamble = raw.slice(0, markers[0].start).trim();
      if (preamble) appendToActive(qDraft, preamble);

      // Learn where each option's content sits horizontally.
      for (const marker of markers) {
        const frag = ev.fragments.find((f) => f.text.includes(marker.letter));
        qDraft.columns[marker.letter] = frag ? frag.x : marker.start;
      }

      // The row above a marker row may hold the numerators of stacked
      // fractions, which belong to the options rather than the question text.
      const previous = qDraft.pending.pop();
      if (previous) {
        const spread = distributeByColumn(previous.fragments, qDraft.columns);
        if (spread && looksLikeStackedNumerators(previous.text, spread)) {
          for (const key of OPTION_ORDER) {
            const part = spread[key];
            if (part) qDraft.options[key] += (qDraft.options[key] ? " " : "") + part;
          }
          // It was wrongly appended to the question text when first seen.
          qDraft.text = qDraft.text.slice(0, qDraft.text.length - previous.text.length).trimEnd();
        }
      }
      qDraft.pending = [];

      for (let i = 0; i < markers.length; i++) {
        const end = i + 1 < markers.length ? markers[i + 1].start : raw.length;
        const seg = raw.slice(markers[i].contentStart, end).trim();
        const key = markers[i].letter;
        if (seg) qDraft.options[key] += (qDraft.options[key] ? " " : "") + seg;
        qDraft.active = key;
        qDraft.lastOption = key;
      }
    } else {
      // Once options have started, an unlabelled row is usually a denominator
      // (or a wrapped option); place its parts by column when they line up.
      const spread =
        qDraft.lastOption !== null ? distributeByColumn(ev.fragments, qDraft.columns) : null;
      if (spread) {
        for (const key of OPTION_ORDER) {
          const part = spread[key];
          if (part) qDraft.options[key] += (qDraft.options[key] ? " " : "") + part;
        }
      } else {
        if (qDraft.active === "text") qDraft.pending.push({ text: raw, fragments: ev.fragments });
        appendToActive(qDraft, raw);
      }
    }
  }
  flushQ();
  flushSol();
  const questions: CoachingQuestion[] = qDrafts.map((qd) => {
    const sol = solDrafts.get(qd.n);
    const answer = answerMap.get(qd.n) || sol?.answer || "";
    return {
      questionNumber: qd.n,
      subject: qd.subject,
      section: qd.section,
      questionText: qd.text.trim(),
      optionA: qd.options.A.trim(),
      optionB: qd.options.B.trim(),
      optionC: qd.options.C.trim(),
      optionD: qd.options.D.trim(),
      correctAnswer: answer,
      answerType: "MCQ",
      explanation: (sol?.lines.join("\n") ?? "").trim(),
      diagrams: qd.diagrams,
      optionDiagrams: qd.optionDiagrams,
      explanationDiagrams: sol?.diagrams ?? [],
    };
  });

  return { questions, subjectsFound: Array.from(subjectsFound) };
}
