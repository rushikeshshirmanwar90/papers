import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Textbook from "@/models/Textbook";

export const dynamic = "force-dynamic";

interface TopicObject {
  topicNumber?: string;
  name: string;
  slug?: string;
}

interface ChapterObject {
  chapterNumber: number;
  name: string;
  slug?: string;
  code?: string;
  part?: number;
  pdfPath?: string;
  pages?: number;
  marks?: number;
  topics: (TopicObject | string)[];
}

const normalize = (val: string) => val.trim().toLowerCase().replace(/[^\w\s-]/g, "");

function matchChapter(ch: ChapterObject, target: string): boolean {
  const t = target.trim();
  const num = parseInt(t, 10);
  if (!isNaN(num) && ch.chapterNumber === num) return true;
  const tNorm = normalize(t);
  const nameNorm = normalize(ch.name);
  if (ch.slug && ch.slug.toLowerCase() === tNorm) return true;
  return nameNorm.includes(tNorm) || tNorm.includes(nameNorm);
}

function matchTopic(t: TopicObject | string, target: string): boolean {
  const tStr = typeof t === "string" ? t : t.name;
  const tNum = typeof t === "object" ? t.topicNumber : undefined;
  const targetClean = target.trim();
  if (tNum && (tNum === targetClean || tNum.endsWith(`.${targetClean}`))) return true;
  const tNorm = normalize(tStr);
  const targetNorm = normalize(targetClean);
  return tNorm.includes(targetNorm) || targetNorm.includes(tNorm);
}

/**
 * Flexible Textbook API:
 * Fetch whole textbooks, single chapters, multiple chapters, single topics, or multiple topics.
 *
 * Query Parameters:
 *  - standard / class: "11th" | "12th" | "class-11" | "class-12"
 *  - subject: "Physics" | "Chemistry" | "Mathematics" | "Biology"
 *  - chapter / chapterNumber: single chapter number, name, or slug (e.g. "1" or "Electrostatics")
 *  - chapters: comma-separated list of chapter numbers or names (e.g. "1,2,3")
 *  - topic: single topic name or section number (e.g. "Coulomb's Law" or "1.4")
 *  - topics: comma-separated list of topics (e.g. "Electric Charge,Coulomb's Law")
 *  - search: search keyword in chapters and topics
 */
export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);

    const standardParam = (searchParams.get("standard") || searchParams.get("class") || "").trim();
    const subjectParam = (searchParams.get("subject") || "").trim();
    const chapterParam = (searchParams.get("chapter") || searchParams.get("chapterNumber") || "").trim();
    const chaptersParam = (searchParams.get("chapters") || searchParams.get("chapterNumbers") || "").trim();
    const topicParam = (searchParams.get("topic") || searchParams.get("topicNumber") || "").trim();
    const topicsParam = (searchParams.get("topics") || "").trim();
    const searchParam = (searchParams.get("search") || "").trim().toLowerCase();

    // Map standard (11th, 12th, class-11, class-12)
    let standard = standardParam;
    if (/11/i.test(standardParam)) standard = "11th";
    if (/12/i.test(standardParam)) standard = "12th";

    const filter: Record<string, unknown> = {};
    if (standard) filter.standard = standard;
    if (subjectParam) filter.subject = new RegExp(`^${subjectParam}$`, "i");

    const textbooks = await Textbook.find(filter).lean();

    if (!textbooks || textbooks.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No textbooks found matching the criteria.",
        params: { standard, subject: subjectParam },
      }, { status: 404 });
    }

    // Parse target chapter filters
    const targetChapters: string[] = [];
    if (chapterParam) targetChapters.push(chapterParam);
    if (chaptersParam) {
      targetChapters.push(...chaptersParam.split(",").map((s) => s.trim()).filter(Boolean));
    }

    // Parse target topic filters
    const targetTopics: string[] = [];
    if (topicParam) targetTopics.push(topicParam);
    if (topicsParam) {
      targetTopics.push(...topicsParam.split(",").map((s) => s.trim()).filter(Boolean));
    }

    // 1. TOPIC-LEVEL QUERY: if topics are requested
    if (targetTopics.length > 0) {
      const matchedTopics: Array<{
        standard: string;
        subject: string;
        chapterNumber: number;
        chapterName: string;
        chapterMarks?: number;
        topic: TopicObject | string;
      }> = [];

      for (const tb of textbooks) {
        for (const ch of tb.chapters as ChapterObject[]) {
          if (targetChapters.length > 0 && !targetChapters.some((tc) => matchChapter(ch, tc))) {
            continue;
          }
          for (const t of ch.topics) {
            if (targetTopics.some((tt) => matchTopic(t, tt))) {
              matchedTopics.push({
                standard: tb.standard,
                subject: tb.subject,
                chapterNumber: ch.chapterNumber,
                chapterName: ch.name,
                chapterMarks: ch.marks,
                topic: t,
              });
            }
          }
        }
      }

      return NextResponse.json({
        ok: true,
        kind: targetTopics.length === 1 ? "single_topic" : "multiple_topics",
        count: matchedTopics.length,
        topics: targetTopics.length === 1 && matchedTopics.length === 1 ? matchedTopics[0] : matchedTopics,
      });
    }

    // 2. CHAPTER-LEVEL QUERY: if chapters are requested
    if (targetChapters.length > 0) {
      const matchedChapters: Array<ChapterObject & { standard: string; subject: string }> = [];

      for (const tb of textbooks) {
        for (const ch of tb.chapters as ChapterObject[]) {
          if (targetChapters.some((tc) => matchChapter(ch, tc))) {
            matchedChapters.push({
              standard: tb.standard,
              subject: tb.subject,
              ...ch,
            });
          }
        }
      }

      if (matchedChapters.length === 0) {
        return NextResponse.json({
          ok: false,
          error: "No chapters found matching the specified chapter filter.",
          targetChapters,
        }, { status: 404 });
      }

      if (targetChapters.length === 1 && matchedChapters.length === 1) {
        const singleCh = matchedChapters[0];
        return NextResponse.json({
          ok: true,
          kind: "single_chapter",
          standard: singleCh.standard,
          subject: singleCh.subject,
          chapter: singleCh,
        });
      }

      return NextResponse.json({
        ok: true,
        kind: "multiple_chapters",
        count: matchedChapters.length,
        totalMarks: matchedChapters.reduce((sum, c) => sum + (c.marks || 0), 0),
        chapters: matchedChapters,
      });
    }

    // 3. SEARCH KEYWORD QUERY
    if (searchParam) {
      const searchMatches: Array<{
        standard: string;
        subject: string;
        chapterNumber: number;
        chapterName: string;
        chapterMarks?: number;
        matchedTopic?: TopicObject | string;
      }> = [];

      for (const tb of textbooks) {
        for (const ch of tb.chapters as ChapterObject[]) {
          const chMatch = ch.name.toLowerCase().includes(searchParam);
          if (chMatch) {
            searchMatches.push({
              standard: tb.standard,
              subject: tb.subject,
              chapterNumber: ch.chapterNumber,
              chapterName: ch.name,
              chapterMarks: ch.marks,
            });
          }
          for (const t of ch.topics) {
            const tStr = typeof t === "string" ? t : t.name;
            if (tStr.toLowerCase().includes(searchParam)) {
              searchMatches.push({
                standard: tb.standard,
                subject: tb.subject,
                chapterNumber: ch.chapterNumber,
                chapterName: ch.name,
                chapterMarks: ch.marks,
                matchedTopic: t,
              });
            }
          }
        }
      }

      return NextResponse.json({
        ok: true,
        kind: "search",
        query: searchParam,
        count: searchMatches.length,
        results: searchMatches,
      });
    }

    // 4. SUBJECT / STANDARD OVERVIEW QUERY
    if (textbooks.length === 1) {
      const tb = textbooks[0];
      return NextResponse.json({
        ok: true,
        kind: "single_textbook",
        standard: tb.standard,
        subject: tb.subject,
        title: tb.title,
        totalChapters: tb.totalChapters,
        totalMarks: tb.totalMarks,
        totalTopics: tb.totalTopics,
        chapters: tb.chapters,
      });
    }

    return NextResponse.json({
      ok: true,
      kind: "multiple_textbooks",
      count: textbooks.length,
      textbooks: textbooks.map((tb) => ({
        standard: tb.standard,
        subject: tb.subject,
        title: tb.title,
        totalChapters: tb.totalChapters,
        totalMarks: tb.totalMarks,
        totalTopics: tb.totalTopics,
        chapters: tb.chapters,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal Server Error",
    }, { status: 500 });
  }
}

