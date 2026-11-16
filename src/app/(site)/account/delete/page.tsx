"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

type Step = "idle" | "confirming" | "busy" | "done" | "error";

const CONSEQUENCES = [
  "Your account and login credentials",
  "All test attempts and scores",
  "All self-assessment history",
  "All practice answers and topic progress",
  "Daily activity and XP / streak data",
  "Any pending tuition join requests",
];

export default function DeleteAccountPage() {
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Step 1 — ask for the Bearer token (this site has no session; the mobile
  // app / API client passes it; for the web we let the user paste it).
  const handleTokenSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return setError("Paste your login token to continue.");
    setError(null);
    setStep("confirming");
  };

  // Step 2 — confirm with password then call the API.
  const handleDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError("Enter your password.");
    setError(null);
    setStep("busy");

    try {
      const res = await fetch("/api/auth/me/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setStep("confirming");
        setError(
          (data && typeof data.error === "string" && data.error) ||
            `Something went wrong (${res.status}).`
        );
        return;
      }

      setStep("done");
    } catch {
      setStep("confirming");
      setError("Could not reach the server. Check your connection and try again.");
    }
  };

  if (step === "done") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Account deleted</h1>
        <p className="mt-2 text-slate-500">
          Your account and all associated data have been permanently removed.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 py-4">

      {/* Header */}
      <div className="space-y-1">
        <Link href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ← Back to Dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Delete your account</h1>
        <p className="text-slate-500">
          This permanently removes your account. It cannot be undone.
        </p>
      </div>

      {/* What gets deleted */}
      <div className="rounded-lg border border-red-200 bg-red-50 p-5">
        <div className="flex gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <p className="font-semibold text-red-800">The following will be permanently deleted:</p>
            <ul className="mt-2 space-y-1">
              {CONSEQUENCES.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm text-red-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm font-medium text-red-800">
              Tuition accounts cannot be deleted from here — contact the platform admin.
            </p>
          </div>
        </div>
      </div>

      {/* Step 1 — token input */}
      {step === "idle" && (
        <form onSubmit={handleTokenSubmit} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Step 1 of 2 — Identify yourself</h2>
            <p className="mt-1 text-sm text-slate-500">
              Paste the login token from your app or API client. This confirms you are the account holder.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Login token</span>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-700 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          {error && <ErrorBox message={error} />}
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500"
            >
              Continue
            </button>
          </div>
        </form>
      )}

      {/* Step 2 — password confirmation */}
      {(step === "confirming" || step === "busy") && (
        <form onSubmit={handleDelete} className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Step 2 of 2 — Confirm with your password</h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter your current password to permanently delete your account.
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your current password"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </label>
          {error && <ErrorBox message={error} />}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => { setStep("idle"); setError(null); setPassword(""); }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={step === "busy"}
              className="inline-flex items-center gap-2 rounded-md bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {step === "busy" && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent" aria-hidden />
              )}
              {step === "busy" ? "Deleting…" : "Delete my account permanently"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
      </svg>
      {message}
    </div>
  );
}
