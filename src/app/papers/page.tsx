"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Paper } from "@shared/types";

export default function PapersPage() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/papers")
      .then((r) => r.json())
      .then(setPapers)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this paper and all its questions? This cannot be undone.")) return;
    await fetch(`/api/papers/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Papers</h1>
          <p className="mt-1 text-slate-500">All uploaded question papers.</p>
        </div>
        <Link
          href="/papers/upload"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          + Upload Paper
        </Link>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : papers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No papers uploaded yet.{" "}
          <Link href="/papers/upload" className="text-indigo-600 underline">
            Upload your first paper
          </Link>
          .
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {papers.map((paper) => (
            <div key={paper._id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between">
                <div>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                    {paper.examType}
                  </span>
                  <h2 className="mt-2 text-lg font-semibold text-slate-900">{paper.title}</h2>
                  <p className="text-sm text-slate-500">
                    Year {paper.year} &middot; {paper.totalQuestions} questions
                  </p>
                </div>
              </div>

              {paper.subjectBreakdown && paper.subjectBreakdown.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {paper.subjectBreakdown.map((s) => (
                    <span
                      key={s.subject}
                      className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                    >
                      {s.subject}: {s.count}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex gap-3">
                <Link
                  href={`/papers/${paper._id}`}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  View / Edit Questions
                </Link>
                <a
                  href={paper.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  View PDF
                </a>
                <button
                  onClick={() => handleDelete(paper._id)}
                  className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
