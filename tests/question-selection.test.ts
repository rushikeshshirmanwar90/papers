import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import { parsePaper } from '@/lib/questionPaper/parse';
import { questionPaperHtml } from '@/lib/questionPaper/html';
import { smartSlidesHtml } from '@/lib/smartSlides/html';
import { renderPaper, renderSlides, setBrowserLauncherForTests } from '@/lib/questionPaper/render';
import { loadPdfjs } from '@/lib/pdfjsNode';
import { DEFAULT_SMART_SLIDE_SETTINGS } from '@/lib/smartSlides/layout';

let mongo: MongoMemoryReplSet;
let token: string;
let batchId: string;
let secondBatchId: string;
let Question: typeof import('@/models/Question')['default'];
let TestRoom: typeof import('@/models/TestRoom')['default'];
let post: typeof import('@/app/api/tests/route')['POST'];
let bankBefore: string;
const closesAt = new Date(Date.now() + 7200000).toISOString();
let questions: Record<string, unknown>[];
const noFigures = { A: [], B: [], C: [], D: [] };
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  assert.match(mongo.getUri(), /^mongodb:\/\/127\.0\.0\.1:/);
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = 'question_selection_test';
  process.env.JWT_SECRET = 'question-selection-test-secret-0123456789abcdef';
  await (await import('@/lib/db')).connectDB();
  const Tuition = (await import('@/models/Tuition')).default;
  const User = (await import('@/models/User')).default;
  const Batch = (await import('@/models/Batch')).default;
  Question = (await import('@/models/Question')).default;
  TestRoom = (await import('@/models/TestRoom')).default;
  post = (await import('@/app/api/tests/route')).POST;
  const tuition = await Tuition.create({ name: 'Selection fixture' });
  const teacher = await User.create({ email: 'selection@test.local', name: 'Teacher', passwordHash: 'x', role: 'teacher', tuitionId: tuition._id, emailVerified: true });
  token = await (await import('@/lib/auth')).signToken(teacher);
  const batch = await Batch.create({ tuitionId: tuition._id, name: 'JEE 11', track: 'JEE', standard: '11th', subjects: ['Physics', 'Chemistry', 'Mathematics'], teachers: [] });
  batchId = String(batch._id);
  const second = await Batch.create({ tuitionId: tuition._id, name: 'JEE 11 B', track: 'JEE', standard: '11th', subjects: ['Physics', 'Chemistry', 'Mathematics'], teachers: [] });
  secondBatchId = String(second._id);
  const docs = await Question.insertMany(['Physics', 'Chemistry', 'Mathematics'].map((subject, i) => ({
    paperId: tuition._id, questionNumber: i + 1, examCategory: 'JEE/NEET', standard: '11th', subject,
    chapter: 'Chapter', topic: 'Topic', questionText: `Find ${i + 1} + 1.`, optionA: '2', optionB: '3', optionC: '4', optionD: '5', correctAnswer: 'ABC'[i], answerType: 'MCQ', explanation: `Solution for ${subject}.`, source: 'JEE MAIN 2020',
  }))) as { toObject(): Record<string, unknown>; _id: unknown }[];
  questions = docs.map(d => ({ ...d.toObject(), _id: String(d._id) }));
  bankBefore = JSON.stringify(await Question.collection.find({}).sort({ _id: 1 }).toArray());
});
after(async () => {
  await setBrowserLauncherForTests(null);
  await (await import('mongoose')).default.disconnect();
  await mongo?.stop();
});
const publish = async (extra: Record<string, unknown> = {}, expected = 200) => {
  const response = await post(new NextRequest('http://localhost:3000/api/tests', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ batchIds: [batchId], title: 'Combined test', subject: 'Physics', subjects: ['Physics', 'Chemistry', 'Mathematics'], subjectTargets: ['Physics', 'Chemistry', 'Mathematics'].map(subject => ({ subject, count: 1 })), questions, startNow: true, closesAt, durationMinutes: 60, ...extra }),
  }), {});
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
};
describe('multi-subject publication', () => {
  test('stores original question subjects using existing record fields, and retries create once', async () => {
    const first = await publish({ requestId: 'selection_retry_001' });
    const retry = await publish({ requestId: 'selection_retry_001' });
    assert.equal(first.test.id, retry.test.id);
    const saved = await TestRoom.findById(first.test.id);
    assert.equal(saved.subject, 'Physics, Chemistry, Mathematics');
    assert.deepEqual(saved.questions.map((q: { subject: string }) => q.subject), ['Physics', 'Chemistry', 'Mathematics']);
    assert.equal(await TestRoom.countDocuments({ creationRequestId: 'selection_retry_001' }), 1);
  });
  test('rejects subjects outside the chosen batch, incorrect counts, duplicates, spoofed subject ids and unsupported formats', async () => {
    await publish({ subjects: ['Physics', 'Biology'] }, 400);
    await publish({ subjectTargets: [{ subject: 'Physics', count: 2 }] }, 400);
    await publish({ questions: [questions[0], questions[0], questions[2]] }, 400);
    await publish({ questions: [questions[0], { ...questions[1], _id: questions[0]._id }, questions[2]] }, 400);
    await publish({ questions: [{ ...questions[0], _id: questions[1]._id }, { ...questions[1], _id: questions[0]._id }, questions[2]] }, 400);
    await publish({ questions: [questions[0], { ...questions[1], answerType: 'Numerical' }, questions[2]] }, 400);
  });
  test('old single-subject requests work and discovery/publication leaves the question bank unchanged', async () => {
    await publish({ subjects: undefined, subjectTargets: undefined, questions: [questions[0]] });
    assert.equal(JSON.stringify(await Question.collection.find({}).sort({ _id: 1 }).toArray()), bankBefore);
  });
  test('combined tests retain the multi-batch audience and reject non-bank question identities', async () => {
    const created = await publish({ batchIds: [batchId, secondBatchId] });
    const saved = await TestRoom.findById(created.test.id);
    assert.deepEqual(saved.batchIds.map(String), [batchId, secondBatchId]);
    await publish({ questions: [{ ...questions[0], _id: 'invalid' }, questions[1], questions[2]] }, 400);
  });
  test('Test Management can update a scheduled combined test without losing subject metadata', async () => {
    const created = await publish({ startNow: false, opensAt: new Date(Date.now() + 86400000).toISOString(), closesAt: new Date(Date.now() + 93600000).toISOString() });
    const route = await import('@/app/api/tests/[id]/route');
    const response = await route.PATCH(new NextRequest(`http://localhost:3000/api/tests/${created.test.id}`, {
      method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ questions: [...questions].reverse() }),
    }), { params: { id: created.test.id } });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const saved = await TestRoom.findById(created.test.id);
    assert.deepEqual(saved.questions.map((q: { subject: string }) => q.subject), ['Mathematics', 'Chemistry', 'Physics']);
  });
});

function paper() {
  return parsePaper({ title: 'Combined practice', subject: 'Physics, Chemistry, Mathematics', standard: '11th', marksPerQuestion: 4, answerKey: true, solutions: true,
    questions: questions.map(q => ({ ...q, diagramUrls: [], explanationDiagramUrls: [], optionDiagramUrls: noFigures })) });
}
describe('subject-aware PDF engines', () => {
  test('questions, answers and solutions share section boundaries and continuous numbering', () => {
    const html = questionPaperHtml(paper(), new Map());
    // A subject heading in the questions and the solutions, and a subject table in the key; no Section A/B labels.
    for (const heading of ['PHYSICS</span>', 'CHEMISTRY</span>', 'MATHEMATICS</span>']) assert.equal(html.split(heading).length - 1, 3);
    assert.ok(!/SECTION [A-C] - /.test(html));
    for (const answer of ['1 - A', '2 - B', '3 - C']) assert.ok(html.includes(answer));
    assert.ok(html.includes('column-count: 2'));
    assert.ok(html.includes('break-after: avoid'));
    assert.ok(!html.includes('class="watermark"'));
    const smart = smartSlidesHtml({ ...paper(), format: 'smart' }, new Map());
    for (const name of ['PHYSICS', 'CHEMISTRY', 'MATHEMATICS']) assert.ok(smart.includes(`<span class="subj">${name}</span>`));
    assert.equal((smart.match(/class="slide q"/g) ?? []).length, 3);
  });
  test('legacy requests without per-question subjects retain original single-subject headings', () => {
    const p = paper();
    p.subject = 'Physics'; p.questions = [{ ...p.questions[0], subject: undefined }];
    assert.ok(questionPaperHtml(p, new Map()).includes('Physics - Section A'));
  });
  test('Botany and Zoology retain original metadata within one Biology section', () => {
    const p = paper();
    p.subject = 'Biology'; p.questions = [{ ...p.questions[0], subject: 'Botany' }, { ...p.questions[0], subject: 'Zoology' }];
    const html = questionPaperHtml(p, new Map());
    assert.equal(html.split('SECTION A - BIOLOGY').length - 1, 3);
    assert.ok(!html.includes('SECTION B'));
    assert.deepEqual(p.questions.map(q => q.subject), ['Botany', 'Zoology']);
  });
  test('Chrome prints the multi-subject Exam PDF and Smart PDF without layout errors', async () => {
    const p = paper();
    const exam = await renderPaper(questionPaperHtml(p, new Map()), p.questions.length, 30000);
    assert.deepEqual(exam.layout.issues.filter(i => i.severity === 'error'), []);
    const pdfjs = await loadPdfjs();
    const examDoc = await pdfjs.getDocument({ data: exam.pdf.slice(), useSystemFonts: true }).promise;
    let text = '';
    for (let i = 1; i <= examDoc.numPages; i++) {
      const page = await examDoc.getPage(i);
      text += (await page.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
    }
    for (const subject of ['PHYSICS', 'CHEMISTRY', 'MATHEMATICS']) assert.ok(text.includes(subject));
    const smart = await renderSlides(smartSlidesHtml(p, new Map()), DEFAULT_SMART_SLIDE_SETTINGS, 30000);
    assert.equal(smart.fit.stats.questions, 3);
    assert.deepEqual(smart.fit.issues.filter(i => i.severity === 'error'), []);
    assert.ok(smart.pdf?.length);
    if (process.env.QUESTION_SELECTION_QA === '1') {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir('qa/question-selection', { recursive: true });
      await writeFile('qa/question-selection/exam.pdf', exam.pdf);
      await writeFile('qa/question-selection/smart.pdf', smart.pdf!);
    }
  });
});
