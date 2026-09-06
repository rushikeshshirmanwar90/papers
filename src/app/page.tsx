"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardStats } from "@shared/types";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-500">Overview of papers, questions, and student activity.</p>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Papers" value={stats.totalPapers} />
            <StatCard label="Total Questions" value={stats.totalQuestions} />
            <StatCard label="Student Attempts" value={stats.totalAttempts} />
            <StatCard label="Registered Students" value={stats.totalStudents} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Papers by Exam Type
            </h2>
            {stats.papersByExamType.length === 0 ? (
              <p className="text-slate-400">No papers uploaded yet.</p>
            ) : (
              <div className="flex gap-6">
                {stats.papersByExamType.map((e) => (
                  <div key={e.examType} className="flex items-center gap-2">
                    <span className="rounded-full bg-indigo-100 px-3 py-1 text-sm font-semibold text-indigo-700">
                      {e.examType}
                    </span>
                    <span className="text-slate-600">{e.count} papers</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-red-500">Failed to load dashboard stats.</p>
      )}

      <div className="flex gap-4">
        <Link
          href="/papers/upload"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Upload a New Paper
        </Link>
        <Link
          href="/papers"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          View All Papers
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
