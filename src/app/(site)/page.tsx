"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { DashboardStats } from "@shared/types";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TuitionRow {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
  loginEmail: string | null;
  adminName: string | null;
  teachers: number;
  students: number;
  batches: number;
  createdAt: string;
}

type Tab = "overview" | "tuition";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || `Server error (${res.status}).`);
  return data as T;
}

function generatePassword(length = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setStatsLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-500">Overview of papers, questions, and student activity.</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-6" aria-label="Dashboard tabs">
          <TabButton label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
          <TabButton label="Tuitions" active={activeTab === "tuition"} onClick={() => setActiveTab("tuition")} />
        </nav>
      </div>

      {/* Overview tab */}
      {activeTab === "overview" && (
        <>
          {statsLoading ? (
            <p className="text-slate-500">Loading…</p>
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
                  <div className="flex flex-wrap gap-4">
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
        </>
      )}

      {/* Tuitions tab */}
      {activeTab === "tuition" && <TuitionsTab />}
    </div>
  );
}

// ─── Tuitions tab ───────────────────────────────────────────────────────────

function TuitionsTab() {
  const [tuitions, setTuitions] = useState<TuitionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TuitionRow | null>(null);
  const [deleting, setDeleting] = useState<TuitionRow | null>(null);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = (q = query) => {
    setLoading(true);
    setError(null);
    apiFetch<{ tuitions: TuitionRow[] }>(`/api/tuitions${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then((d) => setTuitions(d.tuitions))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Initial load + re-load when query changes.
  useEffect(() => { load(query); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = tuitions ?? [];

  return (
    <>
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search tuitions"
          className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Add tuition
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => load()} className="ml-4 font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading && !tuitions ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            {query ? `No tuition matches "${query}".` : "No tuitions yet. Add the first one."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Login email</Th>
                  <Th className="text-right">Teachers</Th>
                  <Th className="text-right">Students</Th>
                  <Th className="text-right">Batches</Th>
                  <Th>Added</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{t.name}</p>
                      {t.adminName && <p className="text-xs text-slate-500">{t.adminName}</p>}
                      {t.address && <p className="mt-0.5 max-w-[28ch] truncate text-xs text-slate-400">{t.address}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={t.active} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{t.loginEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{t.teachers}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{t.students}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{t.batches}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(t.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <ActionButton onClick={() => setEditing(t)}>Edit</ActionButton>
                        <ActionButton variant="danger" onClick={() => setDeleting(t)}>Delete</ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <AddTuitionDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => { setAdding(false); load(); }}
      />
      <EditTuitionDialog
        tuition={editing}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setTuitions((prev) => prev ? prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)) : prev);
          setEditing(null);
        }}
      />
      <DeleteTuitionDialog
        tuition={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          setTuitions((prev) => prev ? prev.filter((t) => t.id !== id) : prev);
          setDeleting(null);
        }}
      />
    </>
  );
}

// ─── Add dialog ─────────────────────────────────────────────────────────────

type AddForm = { name: string; adminName: string; address: string; phone: string; loginEmail: string; password: string };
const EMPTY_ADD: AddForm = { name: "", adminName: "", address: "", phone: "", loginEmail: "", password: "" };

function AddTuitionDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState<AddForm>({ ...EMPTY_ADD, password: generatePassword() });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const prevOpen = useRef(false);

  if (open && !prevOpen.current) {
    prevOpen.current = true;
    // Reset state when dialog opens (can't call setState during render, so use ref trick).
  }
  if (!open && prevOpen.current) {
    prevOpen.current = false;
  }

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_ADD, password: generatePassword() });
      setError(null);
      setCreated(null);
      setCopied(false);
      setBusy(false);
    }
  }, [open]);

  const set = (key: keyof AddForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim() || !form.adminName.trim() || !form.loginEmail.trim()) {
      return setError("Enter the tuition name, admin name and login email.");
    }
    if (form.password.length < 8) return setError("Password needs at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/tuitions", { method: "POST", body: form });
      setCreated({ name: form.name, email: form.loginEmail, password: form.password });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the tuition.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard?.writeText(`PCMB login for ${created.name}\nEmail: ${created.email}\nPassword: ${created.password}`).catch(() => {});
    setCopied(true);
  };

  if (!open) return null;

  return (
    <Modal title={created ? "Tuition added" : "Add tuition"} onClose={onClose}>
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>{created.name}</strong> can now log in. Send them these details — the password is only shown once.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-900">{created.email}</dd>
            <dt className="text-slate-500">Password</dt>
            <dd className="font-medium text-slate-900">{created.password}</dd>
          </dl>
          <div className="flex justify-end gap-2 pt-2">
            <ModalButton variant="secondary" onClick={copy}>{copied ? "Copied!" : "Copy login"}</ModalButton>
            <ModalButton onClick={onClose}>Done</ModalButton>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Tuition name" value={form.name} onChange={set("name")} placeholder="e.g. Sharma Classes" required />
          <FormField label="Admin name" value={form.adminName} onChange={set("adminName")} placeholder="e.g. Rakesh Sharma" hint="The person who runs the tuition." required />
          <FormField label="Address" value={form.address} onChange={set("address")} placeholder="Area and city" />
          <FormField label="Phone" value={form.phone} onChange={set("phone")} type="tel" />
          <FormField label="Login email" value={form.loginEmail} onChange={set("loginEmail")} type="email" hint="Used to log in to the app." required />
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Starting password
              <span className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  value={form.password}
                  onChange={set("password")}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  Generate
                </button>
              </span>
            </label>
            <p className="mt-1 text-xs text-slate-500">At least 8 characters. They can change it in the app.</p>
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <ModalButton variant="secondary" onClick={onClose}>Cancel</ModalButton>
            <ModalButton type="submit" busy={busy}>Add tuition</ModalButton>
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

// ─── Edit dialog ─────────────────────────────────────────────────────────────

type EditForm = { name: string; adminName: string; address: string; phone: string; email: string; active: boolean };

function EditTuitionDialog({
  tuition,
  onClose,
  onSaved,
}: {
  tuition: TuitionRow | null;
  onClose: () => void;
  onSaved: (updated: Partial<TuitionRow> & { id: string }) => void;
}) {
  const [form, setForm] = useState<EditForm>({ name: "", adminName: "", address: "", phone: "", email: "", active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tuition) {
      setForm({
        name: tuition.name,
        adminName: tuition.adminName ?? "",
        address: tuition.address,
        phone: tuition.phone,
        email: tuition.email,
        active: tuition.active,
      });
      setError(null);
      setBusy(false);
    }
  }, [tuition]);

  const set = (key: keyof EditForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tuition) return;
    if (!form.name.trim()) return setError("Enter the tuition name.");
    setBusy(true);
    setError(null);
    try {
      const { tuition: updated } = await apiFetch<{ tuition: TuitionRow }>(`/api/tuitions/${tuition.id}`, {
        method: "PATCH",
        body: form,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  };

  if (!tuition) return null;

  return (
    <Modal title="Edit tuition" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Tuition name" value={form.name} onChange={set("name")} required />
        <FormField label="Admin name" value={form.adminName} onChange={set("adminName")} hint="The person who runs the tuition." />
        <FormField label="Address" value={form.address} onChange={set("address")} />
        <FormField label="Phone" value={form.phone} onChange={set("phone")} type="tel" />
        <FormField label="Contact email" value={form.email} onChange={set("email")} type="email" hint="Contact address for the tuition, not the login." />
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={set("active")}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Active (students and teachers can log in)
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <ModalButton variant="secondary" onClick={onClose}>Cancel</ModalButton>
          <ModalButton type="submit" busy={busy}>Save changes</ModalButton>
        </div>
      </form>
    </Modal>
  );
}

// ─── Delete dialog ───────────────────────────────────────────────────────────

function DeleteTuitionDialog({
  tuition,
  onClose,
  onDeleted,
}: {
  tuition: TuitionRow | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tuition) { setError(null); setBusy(false); }
  }, [tuition]);

  const confirm = async () => {
    if (!tuition) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/tuitions/${tuition.id}`, { method: "DELETE" });
      onDeleted(tuition.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the tuition.");
      setBusy(false);
    }
  };

  if (!tuition) return null;

  return (
    <Modal title="Delete tuition" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          This will permanently delete <strong>{tuition.name}</strong> and all its data: its login account,{" "}
          {tuition.teachers} teacher{tuition.teachers !== 1 ? "s" : ""},{" "}
          {tuition.students} student{tuition.students !== 1 ? "s" : ""},{" "}
          {tuition.batches} batch{tuition.batches !== 1 ? "es" : ""}, and all tests. This cannot be undone.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <ModalButton variant="secondary" onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="danger" busy={busy} onClick={confirm}>Delete permanently</ModalButton>
        </div>
      </div>
    </Modal>
  );
}

// ─── Shared primitives ───────────────────────────────────────────────────────

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "border-b-2 border-indigo-600 pb-3 text-sm font-semibold text-indigo-600"
          : "border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
      }
    >
      {label}
    </button>
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

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-slate-400"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide ${className}`}>{children}</th>;
}

function ActionButton({ children, onClick, variant = "default" }: { children: React.ReactNode; onClick: () => void; variant?: "default" | "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
        variant === "danger"
          ? "text-red-600 hover:bg-red-50"
          : "text-indigo-600 hover:bg-indigo-50"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Close on backdrop click.
  const backdropRef = useRef<HTMLDivElement>(null);
  const onBackdrop = (e: React.MouseEvent) => { if (e.target === backdropRef.current) onClose(); };

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div ref={backdropRef} onMouseDown={onBackdrop} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[520px] rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:text-slate-700"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Form field ──────────────────────────────────────────────────────────────

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

// ─── Modal button ─────────────────────────────────────────────────────────────

function ModalButton({
  children,
  onClick,
  variant = "primary",
  type = "button",
  busy = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  busy?: boolean;
}) {
  const look = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50",
    secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50",
    danger: "bg-red-600 text-white hover:bg-red-500 disabled:opacity-50",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${look}`}
    >
      {busy && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      )}
      {children}
    </button>
  );
}
