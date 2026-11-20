// Additive migration. Source is read-only; target writes are limited to three
// named AI collections. Default is a dry run; --apply is explicit and repeatable.
import { loadEnvConfig } from '@next/env';
import mongoose from 'mongoose';
import { calculate } from '../src/lib/ai-learning/intelligence.mjs';
import { digest } from '../src/lib/ai-learning/profiles.mjs';

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const apply = process.argv.includes('--apply');
const sourceUri = process.env.AI_LEARNING_SOURCE_URI || 'mongodb://127.0.0.1:27017/tuition_ai_lab_dev';
const url = new URL(sourceUri);
if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '27017' || url.pathname !== '/tuition_ai_lab_dev' || url.search) throw new Error('The fixture source must be the existing local tuition_ai_lab_dev database.');
const sourceClient = new mongoose.mongo.MongoClient(sourceUri, { serverSelectionTimeoutMS: 5000 });

async function main() {
  const { connectDB } = await import('../src/lib/db');
  const { AiProfile, AiHistory, AiMapping } = await import('../src/models/AiLearning');
  const { connection } = await connectDB();
  const target = connection.db!;
  if (target.databaseName !== 'pcmb') throw new Error('Migration target must be pcmb.');
  await sourceClient.connect();
  const source = sourceClient.db('tuition_ai_lab_dev');
  const targets = ['ai_learning_profiles', 'ai_learning_history', 'ai_syllabus_mappings'];
  const existing = (await target.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
  for (const name of targets) {
    const sample = existing.includes(name) ? await target.collection(name).findOne({}, { projection: { _id: 0 } }) : null;
    console.log(JSON.stringify({ before: name, count: existing.includes(name) ? await target.collection(name).countDocuments() : 0, fields: Object.keys(sample || {}) }));
  }
  const read = (name: string, limit: number) => source.collection(name).find({}, { projection: { _id: 0 } }).limit(limit).toArray();
  const [students, assessments, nodes, mappings, profiles] = await Promise.all([
    read('ai_lab_students', 11), read('ai_lab_assessments', 56), read('ai_lab_syllabus', 127), read('ai_lab_mappings', 17), read('ai_lab_profiles', 11),
  ]);
  if (students.length !== 10 || assessments.length !== 55 || nodes.length !== 126 || mappings.length !== 16 || profiles.length !== 10 || students.some(s => s.synthetic !== true)) throw new Error('Unexpected source fixture counts; no migration performed.');
  const sourceHash = digest({ students, assessments, nodes, mappings, profiles });
  const writes: { collection: string; key: Record<string, unknown>; value: Record<string, unknown> }[] = [];
  const comparisons = [];
  for (const student of students) {
    const original = profiles.find(p => p.studentId === student.studentId)?.data;
    if (!original?.asOf) throw new Error('Missing source profile reference time.');
    const calculated = calculate(student, assessments, mappings, Date.parse(original.asOf));
    if (digest(calculated) !== digest(original)) throw new Error(`Profile differs from source: ${student.studentId}`);
    const scope = { studentId: student.studentId, userId: null, tuitionId: null, synthetic: true, examVersion: student.examVersion, standard: student.standard };
    writes.push({ collection: targets[0], key: scope, value: { ...scope, student, data: original, sourceHash: digest({ student, original }), generatedAt: new Date(original.asOf) } });
    for (const assessment of assessments.filter(a => a.studentId === student.studentId)) {
      writes.push({ collection: targets[1], key: { synthetic: true, studentId: student.studentId, assessmentId: assessment.assessmentId }, value: { ...scope, assessmentId: assessment.assessmentId, submittedAt: new Date(assessment.submittedAt), sourceHash: digest(assessment), data: assessment } });
    }
    comparisons.push({ studentId: student.studentId, assessments: assessments.filter(a => a.studentId === student.studentId).length, summary: original.summary, profileMatches: true });
  }
  for (const [kind, rows] of [['node', nodes], ['mapping', mappings]] as const) for (const data of rows) {
    const key = { kind, identity: data.nodeId || data.mappingId, versionId: data.versionId || data.examVersion };
    writes.push({ collection: targets[2], key, value: { ...key, synthetic: kind === 'mapping' || data.origin === 'editorial', standard: data.standard, subject: data.subject, reviewStatus: data.reviewStatus, sourceHash: digest(data), data } });
  }
  // Validate EVERY existing target before making the first write. A collision
  // or divergent earlier copy is an explicit error, never an overwrite.
  async function validateTargets(requireAll = false) {
    for (const name of targets) {
      const expected = writes.filter(w => w.collection === name);
      const saved = await target.collection(name).find({ $or: expected.map(w => w.key) }).limit(expected.length + 1).toArray();
      if (requireAll && saved.length !== expected.length) throw new Error(`Target count differs in ${name}.`);
      for (const row of saved) {
        const write = expected.find(w => Object.entries(w.key).every(([k, v]) => String(row[k]) === String(v)));
        if (!write || row.sourceHash !== write.value.sourceHash || digest(row.data) !== digest(write.value.data)) throw new Error(`Existing AI record differs in ${name}; review required.`);
      }
    }
  }
  await validateTargets();
  if (apply) {
    for (const model of [AiProfile, AiHistory, AiMapping]) await model.createIndexes();
    for (const name of targets) {
      await target.collection(name).bulkWrite(writes.filter(w => w.collection === name).map(w => ({ updateOne: { filter: w.key, update: { $setOnInsert: w.value }, upsert: true } })), { ordered: true });
    }
    await validateTargets(true);
  }
  const after = await Promise.all(['ai_lab_students', 'ai_lab_assessments', 'ai_lab_syllabus', 'ai_lab_mappings', 'ai_lab_profiles'].map((name, i) => read(name, [11, 56, 127, 17, 11][i])));
  if (digest({ students: after[0], assessments: after[1], nodes: after[2], mappings: after[3], profiles: after[4] }) !== sourceHash) throw new Error('Source changed during migration.');
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', sourceUnchanged: true, sourceHash, records: writes.length, profiles: comparisons, targetCounts: Object.fromEntries(await Promise.all(targets.map(async name => [name, await target.collection(name).countDocuments()]))) }, null, 2));
}
main().catch(error => {
  console.error(error instanceof Error && !/mongo|server|network/i.test(error.name) ? error.message : 'Database operation failed; credentials suppressed.'); process.exitCode = 1;
}).finally(async () => { await sourceClient.close(); await mongoose.disconnect(); });
