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

  return (
    <div className="space-y-6">
      <div>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
          {paper.examType}
        </span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{paper.title}</h1>
        <p className="mt-1 text-slate-500">
          Year {paper.year} &middot; {questions.length} questions
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Filter by subject:</label>
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
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

      <div className="space-y-4">
        {visibleQuestions.map((q) => {
          const isEditing = editingId === q._id;
          return (
            <div key={q._id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between text-xs">
                <div className="flex gap-2">
                  <span className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                    Q{q.questionNumber}
                  </span>
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
      <p className="font-medium text-slate-800">
        <MathText text={question.questionText} />
      </p>

      <Diagrams urls={question.diagramUrls} className="mt-3" />

      {question.answerType === "MCQ" && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map(([key, text]) => {
            const optionImages = question.optionDiagramUrls?.[key] ?? [];
            return (
              <div
                key={key}
                className={`rounded border px-3 py-1.5 text-sm ${
                  question.correctAnswer === key
                    ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                <strong>{key}.</strong> <MathText text={text} />
                <Diagrams urls={optionImages} className="mt-1" />
              </div>
            );
          })}
        </div>
      )}
      {question.answerType !== "MCQ" && (
        <p className="mt-2 text-sm font-medium text-emerald-700">Answer: {question.correctAnswer}</p>
      )}

      {question.explanation && (
        <Explanation text={question.explanation} diagramUrls={question.explanationDiagramUrls} />
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
