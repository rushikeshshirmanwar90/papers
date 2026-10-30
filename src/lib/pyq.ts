import { badRequest, oneOf } from "@/lib/http";
import { SUBJECTS, SUBJECTS_BY_TRACK, type SchoolSubject, type Track } from "@/lib/school";
import { BANK_SUBJECTS } from "@/lib/syllabus";
import { NOT_A_BANK_COPY } from "@/models/Question";

// Past-year questions: questions whose source names an exam and a year, e.g.
// "NEET 2019", "JEE MAIN 2020", "AIPMT 2014". They come from the question
// bank and from previous-year papers the extractor loads; a paper's copy of a
// question the bank already has is left out, so none is listed twice.

const YEAR = "(19|20)\\d{2}";

/** The exams that count as past papers for each track. */
const EXAMS: Record<Track, string | null> = {
  NEET: "NEET|AIPMT|AIIMS|JIPMER",
  JEE: "JEE|AIEEE|IIT|BITSAT",
  General: null, // any exam
};

/** The Mongo filter for a track's PYQs in some bank subjects. */
function trackFilter(track: Track, bankSubjects: string[]): Record<string, unknown> {
  const exams = EXAMS[track];
  return {
    ...NOT_A_BANK_COPY,
    examCategory: "JEE/NEET",
    subject: { $in: bankSubjects },
    answerType: { $in: ["MCQ", "Numerical"] },
    source: { $regex: exams ? `(${exams}).*${YEAR}|${YEAR}.*(${exams})` : YEAR, $options: "i" },
  };
}

/** The Mongo filter for a track's PYQs in a subject (and chapter). */
export function pyqFilter(track: Track, subject: SchoolSubject, chapter?: string | null) {
  const filter = trackFilter(track, BANK_SUBJECTS[subject]);
  if (chapter) filter.chapter = chapter;
  return filter;
}

/** Every PYQ of the track's subjects: the questions a student may practise. */
export const pyqTrackFilter = (track: Track) => trackFilter(track, SUBJECTS_BY_TRACK[track].flatMap((s) => BANK_SUBJECTS[s]));

/** The subject from ?subject=, checked against the student's track. */
export function readSubject(value: string | null, track: Track): SchoolSubject {
  const subject = oneOf({ subject: value }, "subject", SUBJECTS, "a subject");
  if (!SUBJECTS_BY_TRACK[track].includes(subject)) throw badRequest(`${subject} isn't part of the ${track} track.`);
  return subject;
}
