import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { HttpError } from '@/lib/http';
import { issueDemoSession, requireDemoSession, requireLocalDemo } from './demo';
import { personalProfile, syntheticProfile, syntheticStudents } from './profiles.mjs';
import { buildCompanion } from './companion.mjs';
import { learningActivity, diagnosticReadiness } from './activity';
import { explain, readExplainRequest } from './explain';
import { retrieveTextbookContext } from './textbook-context';

const views: Record<string, string | null> = {
  profile: null, subjects: 'subjects', topics: 'topics', mastery: 'subtopics', subtopics: 'subtopics',
  areas: null, history: 'history', recommendations: 'recommendations',
  'revision-recommendations': 'revisionRecommendations', mistakes: 'mistakes', companion: null, activity: null, diagnostic: null, explain: null,
};
function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function learningRequest(req: NextRequest, parts: string[]) {
  try {
    if (parts.join('/') === 'demo/session' && req.method === 'POST') return response(issueDemoSession(req));
    const asking = req.method === 'POST' && parts.at(-1) === 'explain';
    if (req.method !== 'GET' && !asking) return response({ error: 'Method not allowed.' }, 405);
    const [root, id, view = 'profile'] = parts;
    if (!['students', 'me'].includes(root) || parts.length > 3) throw new HttpError(404, 'Not found.');
    const selectedView = root === 'me' ? id || 'profile' : view;
    if ((root === 'me' && parts.length > 2) || !Object.hasOwn(views, selectedView)) throw new HttpError(404, 'Not found.');
    let profile, database;
    if (root === 'students') {
      requireDemoSession(req); // Gate before touching a database.
      const { connection } = await connectDB();
      database = connection.db;
      if (!id) return response(await syntheticStudents(connection.db));
      if (!/^synthetic-(0[1-9]|10)$/.test(id)) throw new HttpError(404, 'Synthetic student not found.');
      profile = await syntheticProfile(connection.db, id);
    } else {
      if (!req.headers.get('authorization')?.startsWith('Bearer ')) throw new HttpError(401, 'Log in to continue.');
      const { connection } = await connectDB();
      database = connection.db;
      const account = await requireUser(req, 'student');
      profile = await personalProfile(connection, account);
    }
    if (!profile) throw new HttpError(404, 'Learning profile not found. Run the additive fixture migration for local demos.');
    if (selectedView === 'companion') return response(buildCompanion(profile));
    if (selectedView === 'explain' || asking) {
      if (!asking || selectedView !== 'explain') return response({ error: 'Method not allowed.' }, 405);
      const { cell, mode } = readExplainRequest(await req.json().catch(() => null));
      const plan = buildCompanion(profile), area = plan.areas.find((a: { key: string }) => a.key === cell);
      if (!area) throw new HttpError(404, 'Choose a topic from your current study plan.');
      const identity = [...profile.subtopics, ...(profile.foundationAreas || [])].find((a: { key: string }) => a.key === cell);
      const context = await retrieveTextbookContext({ exam: plan.exam || '', standard: area.standard, subject: area.subject,
        chapter: area.chapter, topic: area.topic, subtopic: identity?.subtopic || undefined }, database);
      return response(await explain(`${root}:${profile.student.studentId}`, { ...area, exam: plan.exam }, mode, context));
    }
    if (selectedView === 'diagnostic') return response(await diagnosticReadiness(profile));
    if (selectedView === 'activity') return response(await learningActivity(database, profile, req.nextUrl.searchParams.get('cell')));
    if (selectedView === 'mistakes') return response([...profile.mistakes, ...(profile.foundationMistakes || [])]);
    const value = selectedView === 'areas'
      ? { weak: profile.weakAreas, strong: profile.strongAreas, notStudied: profile.notStudiedAreas, needsDiagnosis: profile.needsDiagnosisAreas }
      : views[selectedView] ? profile[views[selectedView]!] : profile;
    return response(value);
  } catch (error) {
    if (error instanceof HttpError) return response({ error: error.message }, error.status);
    // No URI, raw Mongo error, token, or student record enters the logs.
    console.error('[ai-learning]', error instanceof Error ? error.name : 'UnknownError');
    return response({ error: 'Learning evidence is temporarily unavailable. Try again.' }, 503);
  }
}

// Browser development uses Metro and Next on different loopback ports. Only
// explicitly enabled local demos receive CORS headers, never a wildcard origin.
export function withDemoCors(req: NextRequest, res: Response) {
  const origin = req.headers.get('origin');
  if (!origin) return res;
  try {
    requireLocalDemo(req);
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-AI-Learning-Local');
  } catch { /* Nonlocal and production requests do not get CORS permission. */ }
  return res;
}
