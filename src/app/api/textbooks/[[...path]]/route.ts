import { Types } from 'mongoose';
import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { HttpError } from '@/lib/http';
import { requireDemoSession } from '@/lib/ai-learning/demo';
import { withDemoCors } from '@/lib/ai-learning/handler';
import { textbookMetadata, selectChapter, searchMetadata } from '@/lib/ai-learning/textbooks.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: { path?: string[] } }) {
  let status = 200, data: unknown;
  try {
    if (!req.headers.get('authorization')) throw new HttpError(401, 'Log in to continue.');
    const { connection } = await connectDB();
    let demo = false;
    try { requireDemoSession(req); demo = true; } catch { /* Normal members use the existing session. */ }
    if (!demo) await requireUser(req);
    const path = params.path ?? [], query = req.nextUrl.searchParams;
    const filter: Record<string, unknown> = {};
    const standard = query.get('standard') || query.get('class');
    if (standard) {
      if (!['11', '12', '11th', '12th'].includes(standard)) throw new HttpError(400, 'Choose class 11 or 12.');
      filter.classNum = Number(standard.replace('th', ''));
    }
    const subject = query.get('subject');
    if (subject) {
      if (!['Physics', 'Chemistry', 'Biology', 'Mathematics'].includes(subject)) throw new HttpError(400, 'Choose a supported subject.');
      filter.subject = subject;
    }
    if (path.length && path[0] !== 'search') {
      if (!/^[a-f\d]{24}$/i.test(path[0])) throw new HttpError(400, 'Invalid textbook identity.');
      filter._id = new Types.ObjectId(path[0]);
    }
    const books = (await connection.db!.collection('textbooks').find(filter, { maxTimeMS: 10000 }).sort({ classNum: 1, subject: 1 }).limit(50).toArray()).map(textbookMetadata);
    const q = query.get('q')?.trim();
    const page = Number(query.get('page') || 1), limit = Number(query.get('limit') || 25);
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'Invalid pagination.');
    if (q || path[0] === 'search') {
      if (!q || q.length > 100 || path.length > 1) throw new HttpError(400, 'Enter a search from 1 to 100 characters.');
      const found = searchMetadata(books, q);
      data = { results: found.slice((page - 1) * limit, page * limit), total: found.length, page, limit };
    } else if (!path.length) {
      data = { textbooks: books.slice((page - 1) * limit, page * limit).map(({ chapters, ...book }) => ({ ...book, totalChapters: chapters.length })), total: books.length, page, limit };
    } else {
      const book = books[0];
      if (!book) throw new HttpError(404, 'Textbook not found.');
      if (path.length === 1) data = book;
      else {
        if (path[1] !== 'chapters' || path.length > 6) throw new HttpError(404, 'Not found.');
        if (path.length === 2) data = { textbookId: book.id, chapters: book.chapters };
        else {
          const matches = selectChapter(book, path[2]);
          if (matches.length > 1) throw new HttpError(409, 'Chapter number is ambiguous; use its NCERT code or full identity.');
          const chapter = matches[0];
          if (!chapter) throw new HttpError(404, 'Chapter not found.');
          if (path.length === 3) data = chapter;
          else {
            if (path[3] !== 'topics' || path.length > 5) throw new HttpError(404, 'Not found.');
            if (path.length === 4) data = { textbookId: book.id, chapterId: chapter.id, topics: chapter.topics };
            else {
              const topics = chapter.topics.filter((t: { id: string; topicNumber?: string; slug?: string }) => [t.id, t.topicNumber, t.slug].includes(path[4]));
              if (topics.length !== 1) throw new HttpError(topics.length ? 409 : 404, 'Topic identity is missing or ambiguous.');
              data = topics[0];
            }
          }
        }
      }
    }
  } catch (error) {
    status = error instanceof HttpError ? error.status : 503;
    data = { error: error instanceof HttpError ? error.message : 'Textbook metadata is temporarily unavailable.' };
  }
  return withDemoCors(req, Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } }));
}
export function OPTIONS(req: NextRequest) { return withDemoCors(req, new Response(null, { status: 204 })); }
