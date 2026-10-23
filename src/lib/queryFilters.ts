// Turns the filter query params shared by /api/questions, /api/papers and
// /api/filters into Mongo conditions, so every endpoint filters the same way.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Uploads store the middle level as "Medium" while the apps filter by "Mid";
// both spellings name the same level.
const LEVEL_ALIASES: Record<string, string[]> = {
  Easy: ["Easy"],
  Mid: ["Mid", "Medium"],
  Medium: ["Mid", "Medium"],
  Hard: ["Hard"],
};

const given = (params: URLSearchParams, key: string) => {
  const value = params.get(key)?.trim();
  return value && value !== "All" ? value : null;
};

// Chapter, topic and level may repeat (?chapter=A&chapter=B) to match any of them.
const givenAll = (params: URLSearchParams, key: string) =>
  params
    .getAll(key)
    .map((value) => value.trim())
    .filter((value) => value && value !== "All");

const exactly = (value: string) => new RegExp(`^${escapeRegex(value)}$`, "i");

/**
 * Builds a Mongo filter from the request's query params. `subjectField` is
 * "subject" on questions and "subjects" (an array) on papers.
 */
export function buildFilter(
  params: URLSearchParams,
  subjectField: "subject" | "subjects"
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  const examCategory = given(params, "examCategory");
  if (examCategory) filter.examCategory = examCategory;

  const standard = given(params, "standard");
  if (standard) filter.standard = standard;

  const subject = given(params, "subject");
  if (subject) filter[subjectField] = subject;

  // Chapter and topic come from the dropdowns as exact values; match them
  // whole (case-insensitive) so "ch1" doesn't also pick up "ch10".
  const chapters = givenAll(params, "chapter");
  if (chapters.length) filter.chapter = { $in: chapters.map(exactly) };

  const topics = givenAll(params, "topic");
  if (topics.length) filter.topic = { $in: topics.map(exactly) };

  const difficulties = givenAll(params, "difficulty");
  const levels = difficulties.length ? difficulties : givenAll(params, "level");
  if (levels.length) filter.difficulty = { $in: levels.flatMap((level) => LEVEL_ALIASES[level] ?? [level]) };

  return filter;
}
