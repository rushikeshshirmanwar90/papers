"use client";

import Link from "next/link";
import { Bubble, Empty, ErrorNote, Loading, PageHeader, Panel, Status, Table, Td, formatNumber, useAdminData } from "../ui";

interface Overview {
  totals: { tuitions: number; activeTuitions: number; teachers: number; students: number; batches: number; tests: number; submittedTests: number; practiceAnswers: number };
  week: { testsSet: number; testsTaken: number; activeUsers: number };
  signups: { day: string; students: number; teachers: number }[];
  biggest: { id: string; name: string; active: boolean; students: number }[];
}

const LINK_BUTTON =
  "inline-flex rounded-lg bg-omr-pink px-4 py-2 text-sm font-semibold text-white hover:bg-omr-pink-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-omr-pink";

export default function AdminDashboard() {
  const { data, error, loading, reload } = useAdminData<Overview>("/api/admin/overview");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How the whole network is doing: tuitions, people, and what they did this week."
        actions={
          <Link href="/admin/tuitions?new=1" className={LINK_BUTTON}>
            Add a tuition
          </Link>
        }
      />
      <ErrorNote message={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <Totals totals={data.totals} />
          <SignupChart days={data.signups} />
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <Panel title="Last 7 days">
              <dl className="divide-y divide-omr-rule">
                {[
                  ["Tests set by teachers", data.week.testsSet],
                  ["Tests taken by students", data.week.testsTaken],
                  ["People who logged in", data.week.activeUsers],
                  ["PYQ answers, all time", data.totals.practiceAnswers],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-baseline justify-between px-5 py-3">
                    <dt className="text-[15px] text-omr-lead">{label}</dt>
                    <dd className="text-lg font-semibold">{formatNumber(value as number)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel title="Largest tuitions" description="By number of students">
              <Table head={["Tuition", "Status", "Students"]} empty={data.biggest.length ? null : <Empty title="No students yet">They show here once tuitions enroll them.</Empty>}>
                {data.biggest.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link href={`/admin/tuitions/${t.id}`} className="font-medium hover:text-omr-pink">
                        {t.name}
                      </Link>
                    </Td>
                    <Td>
                      <Status active={t.active} />
                    </Td>
                    <Td className="text-right font-semibold">{formatNumber(t.students)}</Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          </div>
        </>
      ) : null}
      {!loading && data && data.totals.tuitions === 0 ? (
        <Panel>
          <Empty title="No tuitions yet">
            <p>Add the first tuition; it gets a login to add its teachers and students in the app.</p>
            <div className="mt-4">
              <Link href="/admin/tuitions?new=1" className={LINK_BUTTON}>
                Add a tuition
              </Link>
            </div>
          </Empty>
        </Panel>
      ) : null}
    </>
  );
}

/** The network's totals in one ruled row, like the header of an answer sheet. */
function Totals({ totals }: { totals: Overview["totals"] }) {
  const cells: [string, string, string?][] = [
    ["Tuitions", formatNumber(totals.tuitions), totals.tuitions !== totals.activeTuitions ? `${totals.activeTuitions} active` : "All active"],
    ["Teachers", formatNumber(totals.teachers)],
    ["Students", formatNumber(totals.students)],
    ["Batches", formatNumber(totals.batches)],
    ["Tests set", formatNumber(totals.tests)],
    ["Tests taken", formatNumber(totals.submittedTests)],
  ];
  return (
    // The 1px gaps over a rule-coloured background draw the lines between cells.
    <section aria-label="Totals" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-omr-rule bg-omr-rule sm:grid-cols-3 lg:grid-cols-6">
      {cells.map(([label, value, note]) => (
        <div key={label} className="bg-omr-sheet px-5 py-4">
          <p className="text-sm text-omr-lead">{label}</p>
          <p className="mt-1 text-[26px] font-bold leading-none">{value}</p>
          {note ? <p className="mt-1.5 text-xs text-omr-lead">{note}</p> : null}
        </div>
      ))}
    </section>
  );
}

/** New students and teachers per day, as stacked columns. */
function SignupChart({ days }: { days: Overview["signups"] }) {
  const max = Math.max(1, ...days.map((d) => d.students + d.teachers));
  const total = days.reduce((n, d) => n + d.students + d.teachers, 0);
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <Panel
      title="New people, last 30 days"
      description={total ? `${formatNumber(total)} joined across all tuitions` : "Nobody joined in the last 30 days"}
      actions={
        <div className="flex gap-4 text-sm text-omr-lead">
          <span className="inline-flex items-center gap-1.5">
            <Bubble on size={10} /> Students
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Bubble on tone="pink" size={10} /> Teachers
          </span>
        </div>
      }
    >
      <div className="px-5 pb-4 pt-6">
        <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={`Sign-ups per day for the last 30 days, ${total} in all.`}>
          {days.map((d) => {
            const h = ((d.students + d.teachers) / max) * 100;
            return (
              <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${label(d.day)}: ${d.students} students, ${d.teachers} teachers`}>
                {d.students + d.teachers ? (
                  <div className="flex flex-col overflow-hidden rounded-t-[3px]" style={{ height: `${h}%` }}>
                    <div className="bg-omr-pink" style={{ flexGrow: d.teachers }} />
                    <div className="bg-omr-ink" style={{ flexGrow: d.students }} />
                  </div>
                ) : (
                  <div className="h-[2px] rounded-full bg-omr-rule" />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-xs text-omr-lead">
          <span>{label(days[0].day)}</span>
          <span>Today</span>
        </div>
      </div>
    </Panel>
  );
}
