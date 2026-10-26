"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Bubble, Button, ErrorNote, Field, adminFetch } from "../ui";

function LoginForm() {
  const params = useSearchParams();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return setError("Enter the admin key.");
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/api/admin/session", { method: "POST", body: { key } });
      const next = params.get("next");
      // Only go back to an admin page on this site.
      window.location.href = next && next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log in.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Admin key" type="password" value={key} onChange={setKey} autoComplete="current-password" hint="The ADMIN_API_KEY set on the server." required />
      <ErrorNote message={error} />
      <Button type="submit" busy={busy}>Log in</Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex gap-1" aria-hidden>
            <Bubble on={false} size={14} />
            <Bubble on tone="pink" size={14} />
            <Bubble on={false} size={14} />
            <Bubble on={false} size={14} />
          </span>
          <span className="text-sm font-semibold text-omr-lead">PCMB Admin</span>
        </div>
        <h1 className="text-[28px] font-bold leading-tight">Log in to run your tuitions</h1>
        <p className="mb-8 mt-2 text-[15px] text-omr-lead">Onboard tuitions, see how the network is doing, and help anyone who&apos;s locked out.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
