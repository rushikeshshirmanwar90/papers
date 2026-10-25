import { badRequest, oneOf } from "@/lib/http";
import { SUBJECTS, SUBJECTS_BY_TRACK, type SchoolSubject, type Track } from "@/lib/school";
import { BANK_SUBJECTS } from "@/lib/syllabus";

// Past-year questions: bank questions whose source names an exam and a year,
// e.g. "NEET 2019", "JEE MAIN 2020", "AIPMT 2014".

const YEAR = "(19|20)\\d{2}";

/** The exams that count as past papers for each track. */
const EXAMS: Record<Track, string | null> = {
  NEET: "NEET|AIPMT|AIIMS|JIPMER",
  JEE: "JEE|AIEEE|IIT|BITSAT",
  General: null, // any exam
};

/** The Mongo filter for a track's PYQs in a subject (and chapter). */
export function pyqFilter(track: Track, subject: SchoolSubject, chapter?: string | null) {
  const exams = EXAMS[track];
  const filter: Record<string, unknown> = {
    examCategory: "JEE/NEET",
    subject: { $in: BANK_SUBJECTS[subject] },
    answerType: { $in: ["MCQ", "Numerical"] },
    source: { $regex: exams ? `(${exams}).*${YEAR}|${YEAR}.*(${exams})` : YEAR, $options: "i" },
  };
  if (chapter) filter.chapter = chapter;
  return filter;
}

/** The subject from ?subject=, checked against the student's track. */
export function readSubject(value: string | null, track: Track): SchoolSubject {
  const subject = oneOf({ subject: value }, "subject", SUBJECTS, "a subject");
  if (!SUBJECTS_BY_TRACK[track].includes(subject)) throw badRequest(`${subject} isn't part of the ${track} track.`);
  return subject;
}
