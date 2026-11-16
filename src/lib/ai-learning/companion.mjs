// Presentation over the existing intelligence engine. No scoring, inference,
// assessment writes, or guessed textbook/official-syllabus joins happen here.
export function examOf(student) {
  const version = student.examVersion.toLowerCase();
  return version.includes('neet') ? 'NEET' : version.includes('jee') ? 'JEE' : null;
}
export const subjectsFor = exam => exam === 'JEE' ? ['Physics', 'Chemistry', 'Mathematics'] : exam === 'NEET' ? ['Physics', 'Chemistry', 'Biology'] : [];
const subjectOf = value => ['Botany', 'Zoology'].includes(value) ? 'Biology' : value;
const sufficient = area => ['strong', 'weak', 'developing'].includes(area.classification);
const titleOf = area => area.subtopic || area.topic || area.chapter || area.subject;

export function trendText(stats, subject = 'Your performance') {
  if (stats?.trend === 'improving') return `${subject} is improving. Keep practising to build on your recent answers.`;
  if (stats?.trend === 'declining') return `${subject} has dipped in recent answers. Revisit mistakes before trying another assessment.`;
  if (stats?.trend === 'stable') return `${subject} is holding steady. Use your next practice to work on one area.`;
  return `More assessment history will help show how ${subject === 'Your performance' ? 'you are' : subject + ' is'} progressing.`;
}

// Four student-facing understanding levels per subtopic, derived only from the
// existing evidence summary. Question difficulty is not reliably recorded, so it
// is not used. Returns null (no confident level) when evidence is insufficient.
export const UNDERSTANDING_LEVELS = ['Foundation', 'Developing', 'Proficient', 'Advanced'];
const UNDERSTANDING_HINTS = {
  Foundation: 'Start with the basic ideas and simple questions.',
  Developing: 'You know parts of this. Practise to make it consistent.',
  Proficient: 'You can handle most questions here. Keep it fresh.',
  Advanced: 'You answer consistently well. Try harder mixed questions.',
};
export function understandingOf(area, mistake) {
  if (!sufficient(area) || area.accuracy === null) return null;
  const repeated = mistake?.repeatedQuestions?.length || 0;
  // Advanced also needs reliable difficulty evidence: enough explicitly Hard questions answered well.
  const hardOk = (area.hardAttempted ?? 0) >= 5 && area.hardCorrect / area.hardAttempted >= 0.7;
  const steady = area.confidence >= 0.7 && area.accuracy >= 85 && (area.recentAccuracy === null || area.recentAccuracy >= 80)
    && !repeated && area.trend !== 'declining' && (area.daysSinceEvidence ?? 0) <= 30 && hardOk;
  const name = area.accuracy < 40 ? 'Foundation' : area.accuracy < 70 ? 'Developing' : steady ? 'Advanced' : 'Proficient';
  return { name, hint: UNDERSTANDING_HINTS[name] };
}

function priorityFor(area, recommendation) {
  if (!area.asked) return 'Not yet studied';
  if (!sufficient(area)) return 'Needs assessment';
  if (area.classification === 'weak' || area.trend === 'declining') return 'Focus first';
  if (area.classification === 'developing') return 'Practice next';
  return recommendation?.revisionUrgency >= 33 ? 'Revise soon' : 'Doing well';
}
function reasonFor(area, mistake, recommendation) {
  if (!area.asked) return 'You have not answered questions in this topic yet. Start with a check of your understanding.';
  if (!sufficient(area)) return 'There are too few answers to judge this topic fairly. Try another assessment to find your starting point.';
  if (area.trend === 'declining') return 'Recent answers were less accurate than your earlier work. Revisit this topic and review the questions you missed.';
  if (area.trend === 'improving') return 'Your recent answers have improved. Practise again to make that progress more consistent.';
  if (mistake?.repeatedQuestions?.length && area.classification !== 'strong') return 'You have missed some of the same questions more than once. Review those questions before trying again.';
  if (area.classification === 'weak') return 'You have struggled with questions in this topic across assessments. Review the concept, then practise again.';
  if (area.classification === 'developing') return 'You are getting some questions right, but your answers are not consistent yet. Work through a question step by step.';
  if (recommendation?.revisionUrgency >= 33) return 'You have done well here, and it has been a while since your last answers. A revision check can help you retain it.';
  return 'Your answers across assessments show that you are doing well here. Keep it fresh with practice.';
}

export function buildCompanion(profile) {
  const exam = examOf(profile.student), allowed = subjectsFor(exam);
  const recommendations = new Map(profile.recommendations.map(r => [r.key, r]));
  const mistakes = new Map([...profile.mistakes, ...(profile.foundationMistakes || [])].map(m => [m.key, m]));
  const inScope = area => allowed.includes(subjectOf(area.subject)) && area.examVersion === profile.student.examVersion;
  const makeArea = area => {
    const r = recommendations.get(area.key), mistake = mistakes.get(area.key);
    const priority = priorityFor(area, r);
    const review = priority === 'Focus first' || priority === 'Revise soon';
    return {
      key: area.key, title: titleOf(area), subject: subjectOf(area.subject), chapter: area.chapter || '', topic: area.topic || '',
      standard: area.standard, priority, reason: reasonFor(area, mistake, r),
      understanding: understandingOf(area, mistake),
      progress: { attempted: area.attempted || 0, correct: area.correct || 0, mistakes: mistake?.incorrect || 0 },
      level: !sufficient(area) ? null : area.classification === 'weak' ? 'Building your basics' : area.classification === 'developing' ? 'Getting better' : 'Doing well',
      next: !area.asked || !sufficient(area) ? 'Check your understanding with an assessment.' : review ? `Revisit ${titleOf(area)} in your class notes, then try related questions.` : 'Solve a question without looking at the solution, then review your steps.',
      trend: trendText(area, area.subject), repeated: !!mistake?.repeatedQuestions?.length,
      hasMistakes: !!mistake?.incorrect, lastEvidenceAt: area.lastEvidenceAt || null,
      examNote: r?.reviewStatus === 'verified' ? 'Exam applicability has been reviewed for this topic.' : 'Priority comes from your learning history. Official exam weightage is not available for this topic.',
      foundation: area.standard !== profile.student.standard,
    };
  };
  const rawAreas = [...profile.subtopics.filter(a => a.standard === profile.student.standard), ...(profile.foundationAreas || []).filter(a => profile.student.standard === '12' && a.standard === '11')].filter(inScope);
  const order = ['Focus first', 'Practice next', 'Revise soon', 'Needs assessment', 'Not yet studied', 'Doing well'];
  const ranked = rawAreas.map(makeArea).sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority)
    || (recommendations.get(b.key)?.score || 0) - (recommendations.get(a.key)?.score || 0) || a.key.localeCompare(b.key));
  // A named prerequisite is used only when its relationship is explicitly reviewed
  // and the exact prerequisite is present in the student's scoped evidence.
  for (const r of profile.recommendations) {
    for (const link of r.prerequisites || []) {
      if (link.reviewStatus !== 'verified') continue;
      const target = ranked.find(a => a.key === r.key), prerequisite = ranked.find(a => a.key === link.key);
      if (!target || !prerequisite || target.subject !== prerequisite.subject || prerequisite.priority === 'Doing well') continue;
      prerequisite.reason += ` This is a reviewed prerequisite for ${target.title}.`;
      const from = ranked.indexOf(prerequisite), to = ranked.indexOf(target);
      if (from > to) { ranked.splice(from, 1); ranked.splice(to, 0, prerequisite); }
    }
  }
  const starting = !rawAreas.some(sufficient);
  const priorities = ranked.slice(0, 3);
  const roadmap = priorities.map((area, index) => ({ id: `topic:${area.key}`, cell: area.key,
    label: index === 0 ? 'Study now' : 'Study next', title: `${area.priority === 'Focus first' || area.priority === 'Revise soon' ? 'Revise' : area.priority === 'Needs assessment' || area.priority === 'Not yet studied' ? 'Explore' : 'Practise'} ${area.title}`,
    reason: area.reason, action: 'Start Learning', kind: 'topic' }));
  if (priorities[0]) {
    if (roadmap.length < 3) roadmap.push({ id: 'review', cell: priorities[0].key, label: 'After studying', title: priorities[0].hasMistakes ? 'Review your mistakes' : 'Find related practice', reason: 'Use a question to check what you can apply without your notes.', action: priorities[0].hasMistakes ? 'Review Mistakes' : 'Find practice', kind: priorities[0].hasMistakes ? 'mistakes' : 'topic' });
    roadmap.push({ id: 'check', cell: priorities[0].key, label: 'Check your understanding', title: 'Try a fresh assessment', reason: 'Your next submitted answers will help update your study plan.', action: profile.student.synthetic ? 'Preview assessment' : 'Check Understanding', kind: 'assessment' });
  } else {
    roadmap.push({ id: 'start', cell: null, label: 'Start here', title: "Find your starting point", reason: 'Choose a subject and take a self assessment. Your answers will help personalize this plan.', action: profile.student.synthetic ? 'Preview assessment' : 'Take a Quick Assessment', kind: 'assessment' });
  }
  return {
    student: profile.student, exam, asOf: profile.asOf, starting,
    message: starting ? "Let's find your starting point." : profile.summary.trend === 'improving' ? 'Your recent work is paying off. Build on it today.' : profile.summary.trend === 'declining' ? 'Take it one topic at a time. Start with a revision check.' : profile.weakAreas.length ? 'One clear next step can make a difference today.' : 'Keep your strengths fresh and explore your next challenge.',
    trend: trendText(profile.summary), priorities, areas: ranked, roadmap: roadmap.slice(0, 5),
    subjects: allowed.map(subject => {
      const areas = ranked.filter(a => a.subject === subject && !a.foundation);
      const stats = profile.subjects.find(a => a.subject === subject && a.standard === profile.student.standard);
      return { subject, trend: trendText(stats, subject), strengths: areas.filter(a => a.level === 'Doing well').map(a => a.title),
        attention: areas.filter(a => ['Focus first', 'Practice next'].includes(a.priority)).map(a => a.title),
        unattempted: areas.filter(a => a.priority === 'Not yet studied').map(a => a.title),
        needsAssessment: areas.filter(a => a.priority === 'Needs assessment').map(a => a.title),
        next: areas[0]?.key || null, hasEvidence: areas.some(a => a.lastEvidenceAt),
      };
    }),
    recent: profile.history.slice(-5).reverse().map(h => ({ at: h.at, text: h.attempted ? 'Assessment submitted' : 'No marked answers recorded' })),
  };
}
