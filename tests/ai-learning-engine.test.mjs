import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures, AS_OF } from './fixtures/ai-learning.mjs';
import { calculate, identity, evidenceFor } from '../src/lib/ai-learning/intelligence.mjs';
const data=fixtures();
const profile=id=>calculate(data.students.find(s=>s.studentId===id),data.assessments,data.mappings,AS_OF);

test('strong, weak, mixed and insufficient students require independent evidence',()=>{
  assert.equal(profile('synthetic-01').summary.classification,'strong');
  assert.equal(profile('synthetic-02').summary.classification,'weak');
  assert.equal(profile('synthetic-05').summary.classification,'developing');
  assert.equal(profile('synthetic-10').summary.classification,'needs diagnosis');
  assert.equal(profile('synthetic-10').needsDiagnosisAreas.length,2);
  assert.equal(profile('synthetic-10').notStudiedAreas.length,2);
  const a=data.assessments[0];
  const tiny={...a,questions:[a.questions[0]],answers:[{index:0,selected:'A'}]};
  assert.equal(calculate(data.students[0],[tiny],data.mappings,AS_OF).summary.classification,'needs diagnosis');
});
test('improvement and decline use earlier versus recent evidence',()=>{
  assert.equal(profile('synthetic-03').summary.trend,'improving');
  assert.equal(profile('synthetic-04').summary.trend,'declining');
  assert(profile('synthetic-03').summary.improvement>60);
  assert(profile('synthetic-04').summary.improvement< -60);
});
test('skips lower mastery without being counted as wrong attempts; scoring is unchanged',()=>{
  const p=profile('synthetic-01');
  assert.equal(p.summary.asked,288); assert.equal(p.summary.attempted,264); assert.equal(p.summary.skipped,24);
  assert.equal(p.summary.accuracy,90.9); assert.equal(p.summary.mastery,83.3);
  assert.equal(p.history[0].result.score,156);
});
test('all identity dimensions separate cells, including same topic across subtopics and versions',()=>{
  const q=data.assessments[0].questions[0];
  for(const field of ['examVersion','subject','standard','chapter','topic','subtopic']) assert.notEqual(identity(q),identity({...q,[field]:`${q[field]}-different`}));
  const p=profile('synthetic-01');
  assert.equal(p.topics.length,3); assert.equal(p.subtopics.length,4);
  const a=data.assessments[0];
  const foreign={...a,assessmentId:'foreign-version',questions:a.questions.map(q=>({...q,examVersion:'other-version'}))};
  assert.deepEqual(calculate(data.students[0],[...data.assessments,foreign],data.mappings,AS_OF),p);
});
test('practice duplicates and duplicate assessments cannot inflate evidence',()=>{
  const a=data.assessments[0], q=a.questions[0];
  const p={...q,studentId:a.studentId,selected:'B',at:a.submittedAt};
  const baseline=evidenceFor(a.studentId,[a]);
  assert.deepEqual(evidenceFor(a.studentId,[a,a],[p,p]),baseline);
  const independent={...p,sourceId:'independent-practice'};
  assert.equal(evidenceFor(a.studentId,[a],[independent,independent]).length,baseline.length+1);
});
test('student isolation and submitted-only data boundary',()=>{
  const p=profile('synthetic-01');
  const assessments=data.assessments.filter(a=>a.studentId==='synthetic-01');
  assert.deepEqual(calculate(data.students[0],assessments,data.mappings,AS_OF),p);
  const ongoing={...assessments[0],assessmentId:'ongoing',status:'in-progress'};
  assert.deepEqual(calculate(data.students[0],[...assessments,ongoing],data.mappings,AS_OF),p);
  assert(p.history.every(a=>a.assessmentId.startsWith('synthetic-01:')));
});
test('ranking prioritizes supported weaknesses, includes reasons, urgency and provisional mappings',()=>{
  const p=profile('synthetic-05');
  assert(p.recommendations.every((r,i,a)=>i===0||a[i-1].score>=r.score));
  assert(p.recommendations[0].subtopic==='Significant Figures' || p.recommendations[0].subtopic==='Electron count');
  assert(p.recommendations.every(r=>r.reason && r.availableQuestions===null && r.bankAvailability==='unknown' && r.reviewStatus==='needs-review'));
  const later=calculate(data.students[4],data.assessments,data.mappings,AS_OF+30*86400000);
  assert(later.recommendations.every(r=>r.revisionUrgency>p.recommendations.find(x=>x.key===r.key).revisionUrgency));
  const m={...data.mappings.find(m=>m.examVersion===data.students[0].examVersion && m.standard==='11'),subtopic:'No evidence'};
  const empty=calculate(data.students[0],data.assessments,[m],AS_OF).recommendations[0];
  assert.equal(empty.score,0); assert.equal(empty.action,'start learning, then take a diagnostic');
  const weak=profile('synthetic-02');
  assert(weak.mistakes.every(m=>m.repeatedQuestions.length===9 && m.repeatedQuestions.every(q=>q.count===6)));
  const boosted=data.mappings.map(m=>({...m,data:{...m.data,prerequisiteImportance:1}}));
  const ranked=calculate(data.students[4],data.assessments,boosted,AS_OF);
  assert(ranked.recommendations.find(r=>r.subtopic==='Electron count').score>p.recommendations.find(r=>r.subtopic==='Electron count').score);
  assert(p.recommendations.every(r=>r.examVersion===data.students[4].examVersion));
});
test('syllabus versions, parent links and editorial review status preserved',()=>{
  assert.equal(data.syllabus.filter(n=>n.type==='unit').length,104);
  assert.equal(new Set(data.syllabus.map(n=>n.nodeId)).size,data.syllabus.length);
  for(const node of data.syllabus.filter(n=>n.parentId)) {
    const parent=data.syllabus.find(p=>p.nodeId===node.parentId);
    assert(parent); assert.equal(parent.versionId,node.versionId);
  }
  assert(data.syllabus.filter(n=>['topic','subtopic'].includes(n.type)).every(n=>n.origin==='editorial' && n.reviewStatus==='needs-review'));
});
test('missing, skipped-only and sparse evidence never become weak; availability remains unknown',()=>{
  const empty=calculate(data.students[0],[],data.mappings,AS_OF);
  assert.equal(empty.summary.mastery,null);
  assert.equal(empty.summary.classification,'not studied');
  assert.equal(empty.notStudiedAreas.length,4);
  assert.equal(empty.weakAreas.length,0);
  assert(empty.topics.every(t=>t.mastery===null));
  assert.equal(empty.coverage.encountered,0);
  assert.equal(empty.coverage.sufficientEvidence,0);
  assert(empty.recommendations.every(r=>r.availableQuestions===null && r.score===0));
  assert.deepEqual(empty.revisionRecommendations,[]);
  const a=data.assessments[0];
  const skipped={...a,answers:a.questions.map((q,index)=>({index,selected:null}))};
  const p=calculate(data.students[0],[skipped],data.mappings,AS_OF);
  assert.equal(p.summary.classification,'needs diagnosis');
  assert.equal(p.summary.mastery,null);
  assert.equal(p.weakAreas.length,0);
  assert.equal(p.coverage.sufficientEvidence,0);
  assert(p.recommendations.every(r=>r.bankAvailability==='unknown'));
});
