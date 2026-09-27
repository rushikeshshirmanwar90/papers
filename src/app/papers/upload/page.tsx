"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function UploadPaperPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [examType, setExamType] = useState<"JEE" | "NEET">("JEE");
  const [examCategory, setExamCategory] = useState<"Foundation" | "JEE/NEET">("JEE/NEET");
  const [standard, setStandard] = useState<"9th" | "10th" | "11th" | "12th">("11th");
  const [subject, setSubject] = useState<string>("Physics");
  const [chapter, setChapter] = useState<string>("");
  const [topic, setTopic] = useState<string>("");
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard" | "Mid">("Medium");
  const [year, setYear] = useState(new Date().getFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ paperId: string; questionCount: number; subjects: string[] } | null>(
    null
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please choose a PDF file.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("pdf", file);
      formData.append("title", title);
      formData.append("examType", examType);
      formData.append("examCategory", examCategory);
      formData.append("standard", standard);
      formData.append("subject", subject);
      formData.append("chapter", chapter);
      formData.append("topic", topic);
      formData.append("difficulty", difficulty);
      formData.append("year", String(year));

      const res = await fetch("/api/papers/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }

      setResult({
        paperId: data.paper._id,
        questionCount: data.questionCount,
        subjects: data.subjectsFound,
      });
    } catch {
      setError("Something went wrong while uploading.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload Paper</h1>
        <p className="mt-1 text-slate-500">
          Upload a PDF question paper — questions, options, answers and worked solutions are extracted
          automatically, tagged with competitive exam category, standard, subject, chapter, topic and level.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Paper Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. JEE Main 2024 Session 1 - Kinematics Practice"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-400">Leave blank to use the PDF file name.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Competitive Category</label>
            <select
              value={examCategory}
              onChange={(e) => {
                const cat = e.target.value as "Foundation" | "JEE/NEET";
                setExamCategory(cat);
                if (cat === "Foundation") {
                  setStandard("9th");
                } else {
                  setStandard("11th");
                }
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none font-semibold text-indigo-700"
            >
              <option value="Foundation">Foundation (9th & 10th)</option>
              <option value="JEE/NEET">JEE / NEET (11th & 12th)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Standard / Grade</label>
            <select
              value={standard}
              onChange={(e) => setStandard(e.target.value as "9th" | "10th" | "11th" | "12th")}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none font-semibold"
            >
              {examCategory === "Foundation" ? (
                <>
                  <option value="9th">9th Grade</option>
                  <option value="10th">10th Grade</option>
                </>
              ) : (
                <>
                  <option value="11th">11th Grade</option>
                  <option value="12th">12th Grade</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Exam Type</label>
            <select
              value={examType}
              onChange={(e) => setExamType(e.target.value as "JEE" | "NEET")}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="JEE">JEE</option>
              <option value="NEET">NEET</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Mathematics">Mathematics</option>
              <option value="Biology">Biology</option>
              <option value="Science">Science (Class 9/10)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Select Level</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as "Easy" | "Medium" | "Hard" | "Mid")}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="Easy">Easy</option>
              <option value="Medium">Mid (Medium)</option>
              <option value="Hard">Hard</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Chapter</label>
            <input
              type="text"
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              placeholder="e.g. Kinematics, Real Numbers"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Motion in 1D, Relative Motion"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">PDF File</label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {result && (
          <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="font-semibold">Extraction complete!</p>
            <p>
              Extracted <strong>{result.questionCount}</strong> questions across subjects:{" "}
              {result.subjects.join(", ") || "unknown"}.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/papers/${result.paperId}`)}
              className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              Review Questions
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {submitting ? "Extracting questions..." : "Upload & Extract"}
        </button>
      </form>
    </div>
  );
}
