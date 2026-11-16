import { readFileSync } from 'node:fs';
import { scoreAnswers } from '../../src/lib/marking.ts';
import { identity } from '../../src/lib/ai-learning/intelligence.mjs';
export const AS_OF = Date.parse('2026-11-14T12:00:00Z');
export function fixtures() {
  const syllabus = JSON.parse(readFileSync(new URL('./syllabus-units.json', import.meta.url), 'utf8'));
  const jee = syllabus.find(n=>n.type==='exam' && n.data.year===2027).versionId;
  const neet = syllabus.find(n=>n.type==='exam' && n.data.year===2026).versionId;
  const scenarios = ['strong','weak','improving','declining','mixed','strong','weak','mixed','improving','insufficient'];
  const students = scenarios.map((scenario,i)=>({ studentId:`synthetic-${String(i+1).padStart(2,'0')}`, examVersion:i%2===0 ? neet : jee, standard:i%4<2 ? '11' : '12', scenario, synthetic:true }));
  const mappings = [];
  for (const examVersion of [jee,neet]) for (const standard of ['11','12']) {
    for (const [subject,number,chapter,topic,subtopic,importance] of [
      ['Physics',1,'Units and Measurements','Measurement foundations','Dimensional Analysis',1],
      ['Physics',1,'Units and Measurements','Measurement foundations','Significant Figures',.7],
      ['Chemistry',1,'Some Basic Concepts of Chemistry','Mole concept','Molar calculations',1],
      ['Chemistry',2,'Atomic Structure','Atomic composition','Electron count',.6],
    ]) {
      const unit = syllabus.find(n=>n.versionId===examVersion && n.subject===subject && n.type==='unit' && n.data.number===number);
      const topicId = `${unit.nodeId}:editorial:${topic.replaceAll(' ','-').toLowerCase()}`;
      const subId = `${topicId}:${subtopic.replaceAll(' ','-').toLowerCase()}`;
      if (!syllabus.some(n=>n.nodeId===topicId)) syllabus.push({ nodeId:topicId, versionId:examVersion, parentId:unit.nodeId, subject, type:'topic', origin:'editorial', reviewStatus:'needs-review', data:{label:topic} });
      if (!syllabus.some(n=>n.nodeId===subId)) syllabus.push({ nodeId:subId, versionId:examVersion, parentId:topicId, subject, type:'subtopic', origin:'editorial', reviewStatus:'needs-review', data:{label:subtopic} });
      const m = { examVersion, subject, standard, chapter, topic, subtopic, unitId:unit.nodeId, confidence:.65, reviewStatus:'needs-review', data:{topicId,subtopicId:subId, relation:'partial', method:'synthetic editorial candidate v1', prerequisiteImportance:importance, applicability:'candidate, not certified; class 12 includes prerequisite revision'} };
      m.mappingId = identity(m);
      mappings.push(m);
    }
  }
  const assessments=[];
  for (const student of students) {
    const cells=mappings.filter(m=>m.examVersion===student.examVersion && m.standard===student.standard);
    for (let session=0;session<(student.scenario==='insufficient'?1:6);session++) {
      const questions=[], given=new Map();
      cells.forEach((m,cell)=>{
        // Sparse demo leaves two existing mapped areas completely unstudied.
        if (student.scenario === 'insufficient' && cell >= 2) return;
        for(let i=0;i<(student.scenario==='insufficient'?2:12);i++) {
          const numeric = i+2;
          const lengthExpressions = ['speed multiplied by time','acceleration multiplied by time squared','area divided by length','volume divided by area','distance travelled in one second','radius of a circle','circumference of a circle','wavelength of a wave','displacement during an interval','height of a building','diameter of a sphere','square root of area'];
          const prompts = [
            [`A quantity is ${lengthExpressions[i]}. Its dimension is:`, 'A'],
            [`How many significant figures are in ${numeric}.00?`, String(String(numeric).length+2)],
            [`How many moles are in ${numeric*18} grams of water? Use molar mass 18 g/mol.`,String(numeric)],
            [`A neutral atom has atomic number ${numeric}. How many electrons does it have?`,String(numeric)],
          ];
          const [questionText,correctAnswer]=prompts[cell];
          const q={...Object.fromEntries(['examVersion','subject','standard','chapter','topic','subtopic'].map(k=>[k,m[k]])), sourceId:`lab-question:${m.mappingId}:${i}`, questionText, answerType:cell===0?'MCQ':'Numerical', correctAnswer, optionA:'Length',optionB:'Time',optionC:'Mass',optionD:'Dimensionless', difficulty:i<4?'Easy':i<9?'Medium':'Hard', explanation:'Synthetic authored diagnostic question; not an official examination question.' };
          const threshold = student.scenario==='strong'?10:student.scenario==='weak'?2:student.scenario==='improving'?(session<3?2:10):student.scenario==='declining'?(session<3?10:2):student.scenario==='mixed'?(cell%2?2:10):1;
          const selected=i===11?null:i<threshold?correctAnswer:cell===0?'B':String(Number(correctAnswer)+100);
          given.set(questions.length,selected); questions.push(q);
        }
      });
      const result=scoreAnswers(questions,given,4,1);
      assessments.push({ assessmentId:`${student.studentId}:session:${session}`, studentId:student.studentId, status:'submitted', submittedAt:new Date(AS_OF-[60,45,30,12,7,2][session]*86400000).toISOString(), questions, answers:result.answers, result });
    }
  }
  return {students,assessments,mappings,syllabus};
}
