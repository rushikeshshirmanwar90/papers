"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  Empty,
  ErrorNote,
  Field,
  Loading,
  PageHeader,
  Panel,
  SearchBox,
  Status,
  Table,
  Td,
  adminFetch,
  formatDate,
  formatNumber,
  generatePassword,
  useAdminData,
} from "../../ui";

interface TuitionRow {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  active: boolean;
  loginEmail: string | null;
  teachers: number;
  students: number;
  batches: number;
  createdAt: string;
}

function TuitionsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const adding = params.get("new") === "1";

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, loading, reload } = useAdminData<{ tuitions: TuitionRow[] }>(`/api/admin/tuitions${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const setAdding = (open: boolean) => router.replace(open ? "/admin/tuitions?new=1" : "/admin/tuitions", { scroll: false });
  const list = data?.tuitions ?? [];

  return (
    <>
      <PageHeader
        title="Tuitions"
        description="Every tuition on PCMB. Each has one login for its owner, who adds its teachers and students in the app."
        actions={<Button onClick={() => setAdding(true)}>Add a tuition</Button>}
      />
      <SearchBox value={search} onChange={setSearch} placeholder="Search by tuition name" label="Search tuitions" />
      <ErrorNote message={error} onRetry={reload} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table
            head={["Tuition", "Status", "Login", "Teachers", "Students", "Batches", "Joined"]}
            empty={
              list.length ? null : query ? (
                <Empty title={`No tuition matches "${query}"`}>Check the spelling, or search a shorter part of the name.</Empty>
              ) : (
                <Empty title="No tuitions yet">Add the first one; it gets a login for the app.</Empty>
              )
            }
          >
            {list.map((t) => (
              <tr key={t.id} className="hover:bg-omr-paper/60">
                <Td>
                  <Link href={`/admin/tuitions/${t.id}`} className="font-semibold hover:text-omr-pink focus-visible:outline focus-visible:outline-2 focus-visible:outline-omr-pink">
                    {t.name}
                  </Link>
                  {t.address ? <p className="mt-0.5 max-w-[28ch] truncate text-xs text-omr-lead">{t.address}</p> : null}
                </Td>
                <Td>
                  <Status active={t.active} />
                </Td>
                <Td className="text-omr-lead">{t.loginEmail ?? "None"}</Td>
                <Td className="text-right">{formatNumber(t.teachers)}</Td>
                <Td className="text-right">{formatNumber(t.students)}</Td>
                <Td className="text-right">{formatNumber(t.batches)}</Td>
                <Td className="whitespace-nowrap text-omr-lead">{formatDate(t.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      <AddTuitionDialog open={adding} onClose={() => setAdding(false)} onAdded={reload} />
    </>
  );
}

function AddTuitionDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const empty = { name: "", address: "", phone: "", loginEmail: "", password: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setForm({ ...empty, password: generatePassword() });
      setError(null);
      setCreated(null);
      setCopied(false);
    }
  }

  const set = (key: keyof typeof empty) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim() || !form.loginEmail.trim()) return setError("Enter the tuition's name and the email it logs in with.");
    if (form.password.length < 8) return setError("The password needs at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      const result = await adminFetch<{ tuition: { id: string; name: string }; login: { email: string } }>("/api/admin/tuitions", { method: "POST", body: form });
      setCreated({ id: result.tuition.id, name: result.tuition.name, email: result.login.email, password: form.password });
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

  return (
    <Dialog
      open={open}
      title={created ? "Tuition added" : "Add a tuition"}
      onClose={onClose}
      footer={
        created ? (
          <>
            <Button variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy login details"}</Button>
            <Link href={`/admin/tuitions/${created.id}`} className="inline-flex rounded-lg bg-omr-pink px-4 py-2 text-sm font-semibold text-white hover:bg-omr-pink-dark">
              Open {created.name}
            </Link>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => submit()} busy={busy}>Add tuition</Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3 text-[15px]">
          <p>
            {created.name} can now log in to the app. Send them these details; the password is only shown here, and they can change it after logging in.
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-lg bg-omr-paper px-4 py-3">
            <dt className="text-omr-lead">Email</dt>
            <dd className="font-medium">{created.email}</dd>
            <dt className="text-omr-lead">Password</dt>
            <dd className="font-medium">{created.password}</dd>
          </dl>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Tuition name" value={form.name} onChange={set("name")} placeholder="e.g. Sharma Classes" required />
          <Field label="Address" value={form.address} onChange={set("address")} placeholder="Area and city" />
          <Field label="Phone" value={form.phone} onChange={set("phone")} type="tel" />
          <Field label="Login email" value={form.loginEmail} onChange={set("loginEmail")} type="email" hint="The owner logs in to the app with this." required />
          <Field
            label="Starting password"
            value={form.password}
            onChange={set("password")}
            autoComplete="off"
            hint="At least 8 characters. They can change it in the app."
            action={<Button variant="secondary" onClick={() => set("password")(generatePassword())}>Generate</Button>}
          />
          <ErrorNote message={error} />
          {/* Enter submits the form. */}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}

export default function TuitionsRoute() {
  return (
    <Suspense>
      <TuitionsPage />
    </Suspense>
  );
}
