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
