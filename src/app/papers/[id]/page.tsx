"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Difficulty, OptionKey, Paper, Question, Section, Subject, AnswerType } from "@shared/types";
import { SUBJECTS } from "@shared/types";
import { MathText } from "@/components/MathText";
import { Explanation } from "@/components/Explanation";

type Draft = Partial<Question>;

export default function PaperDetailPage() {
  const params = useParams<{ id: string }>();
  const paperId = params.id;

  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string>("All");

  const load = () => {
    setLoading(true);
    fetch(`/api/papers/${paperId}`)
      .then((r) => r.json())
      .then((data) => {
        setPaper(data.paper);
        setQuestions(data.questions);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [paperId]);

  const startEdit = (q: Question) => {
    setEditingId(q._id);
    setDraft({ ...q });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/questions/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const updated = await res.json();
      setQuestions((prev) => prev.map((q) => (q._id === editingId ? updated : q)));
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm("Delete this question?")) return;
    await fetch(`/api/questions/${id}`, { method: "DELETE" });
    setQuestions((prev) => prev.filter((q) => q._id !== id));
  };

  if (loading) return <p className="text-slate-500">Loading...</p>;
  if (!paper) return <p className="text-red-500">Paper not found.</p>;

  const visibleQuestions =
    subjectFilter === "All" ? questions : questions.filter((q) => q.subject === subjectFilter);

  const flagged = (q: Question) => /(^|\n)Note:/.test(q.explanation ?? "");

  return (
    <div className="space-y-6">
      <div>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {paper.examType}
        </span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{paper.title}</h1>
        <p className="mt-1 text-slate-500">
          Year {paper.year} &middot; {questions.length} questions &middot; {paper.subjects.join(", ")}
          {paper.pdfUrl && (
            <>
              {" "}&middot;{" "}
              <a href={paper.pdfUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                Original PDF
              </a>
            </>
          )}
        </p>
      </div>

      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-6 py-3 backdrop-blur">
        <label className="text-sm font-medium text-slate-600">Subject:</label>
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="All">All ({questions.length})</option>
          {SUBJECTS.map((s) => {
            const count = questions.filter((q) => q.subject === s).length;
            return count > 0 ? (
              <option key={s} value={s}>
                {s} ({count})
              </option>
            ) : null;
          })}
        </select>
      </div>

      {questions.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Answer key</h2>
          <p className="mb-3 mt-0.5 text-xs text-slate-400">Tap a cell to jump to that question.</p>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {questions.map((q) => (
              <a
                key={q._id}
                href={`#q-${q.questionNumber}`}
                className="flex flex-col items-center rounded border border-slate-200 py-1 font-mono text-xs tabular-nums hover:border-indigo-400"
              >
                <span className="text-[10px] text-slate-400">{q.questionNumber}</span>
                <span className={`font-semibold ${flagged(q) ? "text-amber-600" : "text-emerald-700"}`}>
                  {q.correctAnswer || "–"}
                </span>
              </a>
            ))}
          </div>
          {questions.some(flagged) && (
            <p className="mt-3 text-xs text-slate-500">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
              Amber answers carry a note where the printed paper&apos;s key or options are inconsistent — see the
              solution.
            </p>
          )}
        </div>
      )}

      <div className="space-y-4">
        {visibleQuestions.map((q) => {
          const isEditing = editingId === q._id;
          return (
            <div
              key={q._id}
              id={`q-${q.questionNumber}`}
              className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-serif text-xl font-semibold tabular-nums text-indigo-600">
                    {q.questionNumber}
                  </span>
                  {q.source && (
                    <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[11px] tracking-wide text-slate-600">
                      {q.source}
                    </span>
                  )}
                  {flagged(q) && (
                    <span className="rounded bg-amber-50 px-2 py-1 font-mono text-[11px] tracking-wide text-amber-700">
                      see note
                    </span>
                  )}
                  <span className="rounded bg-blue-50 px-2 py-1 font-medium text-blue-700">{q.subject}</span>
                  <span className="rounded bg-slate-50 px-2 py-1 text-slate-500">Section {q.section}</span>
                  <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">{q.difficulty}</span>
                  <span className="rounded bg-purple-50 px-2 py-1 text-purple-700">{q.answerType}</span>
                </div>
                <div className="flex gap-2">
                  {!isEditing && (
                    <>
                      <button
                        onClick={() => startEdit(q)}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteQuestion(q._id)}
                        className="font-medium text-red-500 hover:underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isEditing ? (
                <EditForm draft={draft} setDraft={setDraft} onSave={saveEdit} onCancel={cancelEdit} saving={saving} />
              ) : (
                <ViewOnly question={q} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ViewOnly({ question }: { question: Question }) {
  const options: [OptionKey, string][] = [
    ["A", question.optionA],
    ["B", question.optionB],
    ["C", question.optionC],
    ["D", question.optionD],
  ];
  return (
    <div>
      <p className="text-[17px] font-medium leading-relaxed text-slate-800">
        <MathText text={question.questionText} />
      </p>

      <Diagrams urls={question.diagramUrls} className="mt-3" />

      {question.answerType === "MCQ" && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map(([key, text]) => {
            const optionImages = question.optionDiagramUrls?.[key] ?? [];
            const correct = question.correctAnswer === key;
            return (
              <div
                key={key}
                className={`flex items-baseline gap-2.5 rounded-md border px-3 py-2 text-[15px] ${
                  correct ? "border-emerald-400 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-700"
                }`}
              >
                <span className={`font-mono text-xs ${correct ? "font-semibold text-emerald-700" : "text-slate-400"}`}>
                  {key}
                </span>
                <span className="min-w-0">
                  <MathText text={text} />
                  <Diagrams urls={optionImages} className="mt-1" />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {question.correctAnswer && (
        <p className="mt-3 font-mono text-xs font-medium text-emerald-700">
          Correct answer: {question.correctAnswer}
        </p>
      )}

      {question.explanation && (
        <Explanation
          text={question.explanation}
          diagramUrls={question.explanationDiagramUrls}
        />
      )}
    </div>
  );
}

function Diagrams({ urls, className = "" }: { urls?: string[]; className?: string }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {urls.map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt="Question diagram"
          className="max-h-56 rounded border border-slate-200 bg-white"
        />
      ))}
    </div>
  );
}

function EditForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const field = (key: keyof Question, value: unknown) => setDraft({ ...draft, [key]: value });

  return (
    <div className="space-y-3">
      <textarea
        value={draft.questionText ?? ""}
        onChange={(e) => field("questionText", e.target.value)}
        rows={2}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["A", "B", "C", "D"] as const).map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-4 text-sm font-semibold">{key}</span>
            <input
              value={(draft[`option${key}` as keyof Question] as string) ?? ""}
              onChange={(e) => field(`option${key}` as keyof Question, e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Source (e.g. JEE Main 2019)</label>
        <input
          value={draft.source ?? ""}
          onChange={(e) => field("source", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Solution — blank line between paragraphs; LaTeX in \( \) or \[ \]; start a paragraph with
          &quot;Note:&quot; for a callout
        </label>
        <textarea
          value={draft.explanation ?? ""}
          onChange={(e) => field("explanation", e.target.value)}
          rows={8}
          className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Subject</label>
          <select
            value={draft.subject}
            onChange={(e) => field("subject", e.target.value as Subject)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Section</label>
          <select
            value={draft.section}
            onChange={(e) => field("section", e.target.value as Section)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Answer Type</label>
          <select
            value={draft.answerType}
            onChange={(e) => field("answerType", e.target.value as AnswerType)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="MCQ">MCQ</option>
            <option value="Numerical">Numerical</option>
            <option value="Bonus">Bonus</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Correct Answer</label>
          <input
            value={draft.correctAnswer ?? ""}
            onChange={(e) => field("correctAnswer", e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Difficulty</label>
          <select
            value={draft.difficulty}
            onChange={(e) => field("difficulty", e.target.value as Difficulty)}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="Easy">Easy</option>
            <option value="Medium">Medium</option>
            <option value="Hard">Hard</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
