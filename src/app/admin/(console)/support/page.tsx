"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Choice, Empty, ErrorNote, Loading, PageHeader, Panel, ResetPasswordDialog, SearchBox, Status, Table, Td, adminFetch, timeAgo, useAdminData } from "../../ui";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "tuition" | "teacher" | "student" | null;
  active: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  tuition: { id: string; name: string; active: boolean } | null;
}

type RoleFilter = "all" | "tuition" | "teacher" | "student" | "none";
const ROLE_LABEL = { tuition: "Tuition owner", teacher: "Teacher", student: "Student" } as const;

/** Find anyone across all tuitions and get them back in: reset passwords, turn logins on or off. */
export default function SupportPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams();
  if (query) qs.set("q", query);
  if (role !== "all") qs.set("role", role);
  const { data, error, loading, reload } = useAdminData<{ users: UserRow[] }>(`/api/admin/users${qs.toString() ? `?${qs}` : ""}`);
  const users = data?.users ?? [];

  const setActive = async (u: UserRow, active: boolean) => {
    setActionError(null);
    try {
      await adminFetch(`/api/admin/users/${u.id}`, { method: "PATCH", body: { active } });
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't change that.");
    }
  };

  return (
    <>
      <PageHeader title="Support" description="Find anyone on PCMB to help them log in: reset a forgotten password, unlock them after wrong guesses, or turn a login on or off." />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Name, email or phone" label="Search people" />
        <Choice<RoleFilter>
          label="Who"
          value={role}
          onChange={setRole}
          options={[
            { value: "all", label: "Everyone" },
            { value: "student", label: "Students" },
            { value: "teacher", label: "Teachers" },
            { value: "tuition", label: "Owners" },
            { value: "none", label: "Not in a tuition" },
          ]}
        />
      </div>
      <ErrorNote message={error ?? actionError} onRetry={error ? reload : undefined} />
      <Panel>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table
            head={["Person", "Role", "Tuition", "Status", "Last login", ""]}
            empty={users.length ? null : <Empty title={query ? `Nobody matches "${query}"` : "Nobody here yet"}>{query ? "Try their email, or part of their name." : "People appear once tuitions add them."}</Empty>}
          >
            {users.map((u) => (
              <tr key={u.id}>
                <Td>
                  <p className="font-semibold">{u.name}</p>
                  <p className="text-xs text-omr-lead">
                    {u.email}
                    {u.phone ? `, ${u.phone}` : ""}
                  </p>
                </Td>
                <Td>{u.role ? ROLE_LABEL[u.role] : <span className="text-omr-lead">No role yet</span>}</Td>
                <Td>
                  {u.tuition ? (
                    <>
                      <Link href={`/admin/tuitions/${u.tuition.id}`} className="hover:text-omr-pink">
                        {u.tuition.name}
                      </Link>
                      {!u.tuition.active ? <p className="text-xs text-omr-fail">Tuition turned off</p> : null}
                    </>
                  ) : (
                    <span className="text-omr-lead">Not joined yet</span>
                  )}
                </Td>
                <Td>
                  <Status active={u.active} locked={u.locked} />
                </Td>
                <Td className="whitespace-nowrap text-omr-lead">{timeAgo(u.lastLoginAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-3 whitespace-nowrap">
                    <Button variant="quiet" onClick={() => setResetting(u)}>
                      {u.locked ? "Unlock and reset" : "Reset password"}
                    </Button>
                    {u.role !== "tuition" ? (
                      <Button variant="quiet" onClick={() => setActive(u, !u.active)}>
                        {u.active ? "Turn login off" : "Turn login on"}
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {users.length === 50 ? <p className="text-sm text-omr-lead">Showing the first 50. Search to narrow it down.</p> : null}
      <ResetPasswordDialog
        open={!!resetting}
        name={resetting?.name ?? ""}
        email={resetting?.email ?? ""}
        endpoint={resetting ? `/api/admin/users/${resetting.id}/password` : ""}
        onClose={() => {
          setResetting(null);
          reload();
        }}
      />
    </>
  );
}
