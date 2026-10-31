"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Bubble,
  Button,
  Choice,
  Dialog,
  Empty,
  ErrorNote,
  Field,
  Loading,
  Panel,
  ResetPasswordDialog,
  Status,
  Table,
  Td,
  adminFetch,
  formatDate,
  timeAgo,
  useAdminData,
} from "../../../ui";

interface Person {
  id: string;
  name: string;
  email: string;
  phone: string;
  active: boolean;
  lastLoginAt: string | null;
}

interface TuitionDetail {
  tuition: { id: string; name: string; address: string; phone: string; email: string; active: boolean; createdAt: string };
  login: { userId: string; email: string; lastLoginAt: string | null } | null;
  batches: { id: string; name: string; track: string; program?: string; academicYear?: string | null; standard: string | null; subjects: string[]; venue: string; weeklyMinutes: number; teachers: string[]; students: number }[];
  teachers: (Person & { subjects: string[] })[];
  students: (Person & { track: string | null; program?: string | null; standard: string | null; batch: string | null })[];
  tests: { id: string; title: string; batch: string | null; questions: number; opensAt: string; closesAt: string | null; submitted: number }[];
}

type Tab = "batches" | "teachers" | "students" | "tests";

const hours = (m: number) => (m ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : "Not set");

export default function TuitionDetailPage({ params }: { params: { id: string } }) {
  const { data, error, loading, reload } = useAdminData<TuitionDetail>(`/api/admin/tuitions/${params.id}`);
  const [tab, setTab] = useState<Tab>("batches");
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState<{ name: string; email: string; endpoint: string } | null>(null);
  const [confirmingToggle, setConfirmingToggle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote message={error ?? "Couldn't load this tuition."} onRetry={reload} />;
  const { tuition, login } = data;

  const setActive = async (active: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      await adminFetch(`/api/admin/tuitions/${tuition.id}`, { method: "PATCH", body: { active } });
      setConfirmingToggle(false);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't change that.");
    } finally {
      setBusy(false);
    }
  };

  const setPersonActive = async (person: Person, active: boolean) => {
    setActionError(null);
    try {
      await adminFetch(`/api/admin/users/${person.id}`, { method: "PATCH", body: { active } });
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't change that.");
    }
  };

  const personActions = (p: Person) => (
    <div className="flex justify-end gap-3">
      <Button variant="quiet" onClick={() => setResetting({ name: p.name, email: p.email, endpoint: `/api/admin/users/${p.id}/password` })}>
        Reset password
      </Button>
      <Button variant="quiet" onClick={() => setPersonActive(p, !p.active)}>
        {p.active ? "Turn login off" : "Turn login on"}
      </Button>
    </div>
  );

  return (
    <>
      <div>
        <Link href="/admin/tuitions" className="text-sm font-medium text-omr-lead hover:text-omr-ink">
          All tuitions
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4 border-b border-omr-rule pb-5">
          <div>
            <h1 className="text-[28px] font-bold leading-tight">{tuition.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] text-omr-lead">
              <Status active={tuition.active} />
              <span>Joined {formatDate(tuition.createdAt)}</span>
              {tuition.address ? <span>{tuition.address}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>Edit details</Button>
            {tuition.active ? (
              <Button variant="danger" onClick={() => setConfirmingToggle(true)}>Turn off tuition</Button>
            ) : (
              <Button onClick={() => setActive(true)} busy={busy}>Turn tuition back on</Button>
            )}
          </div>
        </div>
      </div>

      <ErrorNote message={actionError} />
      {!tuition.active ? (
        <p className="rounded-lg border border-omr-rule bg-omr-sheet px-4 py-3 text-[15px]">
          This tuition is turned off: its owner, teachers and students can&apos;t log in. Nothing is deleted.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Owner's login">
          <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 px-5 py-4 text-[15px]">
            <dt className="text-omr-lead">Email</dt>
            <dd className="font-medium">{login?.email ?? "No login"}</dd>
            <dt className="text-omr-lead">Last login</dt>
            <dd>{timeAgo(login?.lastLoginAt)}</dd>
          </dl>
          {login ? (
            <div className="border-t border-omr-rule px-5 py-3">
              <Button variant="quiet" onClick={() => setResetting({ name: tuition.name, email: login.email, endpoint: `/api/admin/tuitions/${tuition.id}/password` })}>
                Reset the owner&apos;s password
              </Button>
            </div>
          ) : null}
        </Panel>
        <Panel title="Contact">
          <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 px-5 py-4 text-[15px]">
            <dt className="text-omr-lead">Phone</dt>
            <dd>{tuition.phone || "Not set"}</dd>
            <dt className="text-omr-lead">Email</dt>
            <dd>{tuition.email || "Not set"}</dd>
            <dt className="text-omr-lead">Address</dt>
            <dd>{tuition.address || "Not set"}</dd>
          </dl>
        </Panel>
      </div>

      <Choice<Tab>
        label="Show"
        value={tab}
        onChange={setTab}
        options={[
          { value: "batches", label: `Batches (${data.batches.length})` },
          { value: "teachers", label: `Teachers (${data.teachers.length})` },
          { value: "students", label: `Students (${data.students.length})` },
          { value: "tests", label: `Tests (${data.tests.length})` },
        ]}
      />

      <Panel>
        {tab === "batches" ? (
          <Table head={["Batch", "Program", "Subjects and teachers", "Students", "Class time a week"]} empty={data.batches.length ? null : <Empty title="No batches yet">The tuition creates batches in the app.</Empty>}>
            {data.batches.map((b) => (
              <tr key={b.id}>
                <Td className="font-semibold">{b.name}</Td>
                <Td>
                  {b.program ?? b.track}
                  {b.standard ? `, ${b.standard}` : ""}
                  {b.academicYear ? `, ${b.academicYear}` : ""}
                </Td>
                <Td className="text-omr-lead">{b.teachers.length ? b.teachers.join(", ") : b.subjects.join(", ")}</Td>
                <Td className="text-right">{b.students}</Td>
                <Td className="whitespace-nowrap">{hours(b.weeklyMinutes)}</Td>
              </tr>
            ))}
          </Table>
        ) : tab === "teachers" ? (
          <Table head={["Teacher", "Subjects", "Status", "Last login", ""]} empty={data.teachers.length ? null : <Empty title="No teachers yet">The tuition adds teachers in the app.</Empty>}>
            {data.teachers.map((t) => (
              <tr key={t.id}>
                <Td>
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-xs text-omr-lead">{t.email}</p>
                </Td>
                <Td>{t.subjects.join(", ") || "None"}</Td>
                <Td>
                  <Status active={t.active} />
                </Td>
                <Td className="whitespace-nowrap text-omr-lead">{timeAgo(t.lastLoginAt)}</Td>
                <Td>{personActions(t)}</Td>
              </tr>
            ))}
          </Table>
        ) : tab === "students" ? (
          <Table head={["Student", "Program", "Batch", "Status", "Last login", ""]} empty={data.students.length ? null : <Empty title="No students yet">The tuition enrolls students in the app.</Empty>}>
            {data.students.map((s) => (
              <tr key={s.id}>
                <Td>
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-xs text-omr-lead">{s.email}</p>
                </Td>
                <Td>
                  {s.program ?? s.track ?? "Not set"}
                  {s.standard ? `, ${s.standard}` : ""}
                </Td>
                <Td>{s.batch ?? <span className="text-omr-lead">No batch</span>}</Td>
                <Td>
                  <Status active={s.active} />
                </Td>
                <Td className="whitespace-nowrap text-omr-lead">{timeAgo(s.lastLoginAt)}</Td>
                <Td>{personActions(s)}</Td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table head={["Test", "Batch", "Questions", "Opened", "Submitted"]} empty={data.tests.length ? null : <Empty title="No tests yet">Teachers set tests for their batches in the app.</Empty>}>
            {data.tests.map((t) => (
              <tr key={t.id}>
                <Td className="font-semibold">{t.title}</Td>
                <Td>{t.batch ?? "Deleted batch"}</Td>
                <Td className="text-right">{t.questions}</Td>
                <Td className="whitespace-nowrap text-omr-lead">{formatDate(t.opensAt)}</Td>
                <Td className="text-right">
                  <span className="inline-flex items-center gap-2">
                    <Bubble on={t.submitted > 0} size={10} />
                    {t.submitted}
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <EditTuitionDialog open={editing} onClose={() => setEditing(false)} tuition={tuition} onSaved={reload} />
      <ResetPasswordDialog open={!!resetting} name={resetting?.name ?? ""} email={resetting?.email ?? ""} endpoint={resetting?.endpoint ?? ""} onClose={() => setResetting(null)} />
      <Dialog
        open={confirmingToggle}
        title={`Turn off ${tuition.name}?`}
        onClose={() => setConfirmingToggle(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingToggle(false)}>Keep it on</Button>
            <Button variant="danger" onClick={() => setActive(false)} busy={busy}>Turn off tuition</Button>
          </>
        }
      >
        <p className="text-[15px]">
          Its owner, {data.teachers.length} teacher{data.teachers.length === 1 ? "" : "s"} and {data.students.length} student
          {data.students.length === 1 ? "" : "s"} are logged out and can&apos;t log in until you turn it back on. Their data stays.
        </p>
      </Dialog>
    </>
  );
}

function EditTuitionDialog({ open, onClose, tuition, onSaved }: { open: boolean; onClose: () => void; tuition: TuitionDetail["tuition"]; onSaved: () => void }) {
  const [form, setForm] = useState({ name: tuition.name, address: tuition.address, phone: tuition.phone, email: tuition.email });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setForm({ name: tuition.name, address: tuition.address, phone: tuition.phone, email: tuition.email });
      setError(null);
    }
  }
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) return setError("Enter the tuition's name.");
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/tuitions/${tuition.id}`, { method: "PATCH", body: form });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title="Edit details"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} busy={busy}>Save changes</Button>
        </>
      }
    >
      <Field label="Tuition name" value={form.name} onChange={set("name")} required />
      <Field label="Address" value={form.address} onChange={set("address")} />
      <Field label="Phone" value={form.phone} onChange={set("phone")} type="tel" />
      <Field label="Contact email" value={form.email} onChange={set("email")} type="email" hint="Shown to its teachers and students. The login email doesn't change." />
      <ErrorNote message={error} />
    </Dialog>
  );
}
