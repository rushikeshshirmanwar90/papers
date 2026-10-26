"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Building blocks for the admin console. The look is an OMR answer sheet:
// status is an answer bubble (filled = on), pink ink is the one accent.

// ─── Requests ──────────────────────────────────────────────────────────────

export class AdminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Calls /api/admin…; an expired session goes back to the login page. */
export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/api/admin/session") {
    window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) throw new AdminError(res.status, (data && typeof data.error === "string" && data.error) || `The server couldn't do that (${res.status}).`);
  return data as T;
}

/** Loads data on mount and when `key` changes; reload() fetches again. */
export function useAdminData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = path ? `${path}#${round}` : null;

  useEffect(() => {
    if (!path || !key) return;
    let cancelled = false;
    adminFetch<T>(path).then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoadedFor(key);
      },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load this.");
        setLoadedFor(key);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  return { data, error, loading: loadedFor !== key, reload: useCallback(() => setRound((n) => n + 1), []) };
}

// ─── Formatting ────────────────────────────────────────────────────────────

export const formatNumber = (n: number) => n.toLocaleString("en-IN");

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "Never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return formatDate(iso);
}

/** A readable password: no look-alike characters (0/O, 1/l). */
export function generatePassword(length = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// ─── The bubble ────────────────────────────────────────────────────────────

/** An OMR answer bubble: filled when on, an empty ring when off. */
export function Bubble({ on, tone = "ink", size = 12 }: { on: boolean; tone?: "ink" | "pink"; size?: number }) {
  const filled = tone === "pink" ? "bg-omr-pink border-omr-pink" : "bg-omr-ink border-omr-ink";
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-full border-[1.5px] ${on ? filled : "border-omr-lead/60 bg-transparent"}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A tuition's or a login's state: active (filled) or turned off (empty). */
export function Status({ active, locked = false }: { active: boolean; locked?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Bubble on={active} />
      <span className={active ? "text-omr-ink" : "text-omr-lead"}>{active ? "Active" : "Turned off"}</span>
      {locked ? <span className="rounded bg-omr-fail-soft px-1.5 py-0.5 text-xs font-medium text-omr-fail">Locked out</span> : null}
    </span>
  );
}

// ─── Controls ──────────────────────────────────────────────────────────────

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-omr-pink";

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
  busy = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "quiet";
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
}) {
  const look = {
    primary: "bg-omr-pink text-white hover:bg-omr-pink-dark",
    secondary: "border border-omr-rule bg-omr-sheet text-omr-ink hover:border-omr-lead/50",
    danger: "border border-omr-fail/30 bg-omr-sheet text-omr-fail hover:bg-omr-fail-soft",
    quiet: "text-omr-pink hover:text-omr-pink-dark",
  }[variant];
  const size = variant === "quiet" ? "px-1 py-1" : "px-4 py-2";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className={`inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${size} ${look} ${FOCUS}`}
    >
      {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  required = false,
  action,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  /** e.g. a Generate button beside the input. */
  action?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-omr-ink">{label}</span>
      <span className="mt-1.5 flex gap-2">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={`w-full rounded-lg border border-omr-rule bg-omr-sheet px-3 py-2 text-[15px] text-omr-ink placeholder:text-omr-lead/70 ${FOCUS}`}
        />
        {action}
      </span>
      {hint ? <span className="mt-1 block text-xs text-omr-lead">{hint}</span> : null}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className={`w-full max-w-md rounded-lg border border-omr-rule bg-omr-sheet px-3 py-2 text-[15px] placeholder:text-omr-lead/70 ${FOCUS}`}
    />
  );
}

/** One of a few options, as a row of answer-sheet choices. */
export function Choice<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-omr-rule bg-omr-sheet p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${on ? "bg-omr-paper font-semibold text-omr-ink" : "text-omr-lead hover:text-omr-ink"} ${FOCUS}`}
          >
            <Bubble on={on} tone="pink" size={10} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Layout ────────────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-omr-rule pb-5">
      <div className="max-w-2xl">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.01em] text-omr-ink">{title}</h1>
        {description ? <p className="mt-1.5 text-[15px] text-omr-lead">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, description, children, actions }: { title?: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-omr-rule bg-omr-sheet">
      {title ? (
        <div className="flex items-start justify-between gap-3 border-b border-omr-rule px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold text-omr-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-omr-lead">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-omr-rule text-omr-lead">
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-5 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-omr-rule">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`px-5 py-3 align-middle ${className}`}>{children}</td>;

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-semibold text-omr-ink">{title}</p>
      {children ? <div className="mt-1 text-sm text-omr-lead">{children}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-omr-lead" role="status">
      {label}
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-omr-fail/25 bg-omr-fail-soft px-4 py-2.5 text-sm text-omr-fail">
      <span>{message}</span>
      {onRetry ? <Button variant="quiet" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

// ─── Dialog ────────────────────────────────────────────────────────────────

/** A modal dialog (native <dialog>: focus is trapped, Esc closes it). */
export function Dialog({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="w-[min(520px,calc(100vw-2rem))] rounded-xl border border-omr-rule bg-omr-sheet p-0 text-omr-ink shadow-[0_24px_60px_-20px_rgba(35,38,45,0.35)] backdrop:bg-omr-ink/40"
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-omr-rule px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className={`rounded-md p-1 text-omr-lead hover:text-omr-ink ${FOCUS}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="space-y-4 overflow-y-auto px-5 py-5">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-omr-rule px-5 py-4">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/** Sets a new password for someone; shows it once so it can be passed on. */
export function ResetPasswordDialog({ open, name, email, onClose, endpoint }: { open: boolean; name: string; email: string; onClose: () => void; endpoint: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setPassword(generatePassword());
      setError(null);
      setDone(false);
      setCopied(false);
    }
  }

  const save = async () => {
    if (password.length < 8) return setError("The password needs at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await adminFetch(endpoint, { method: "POST", body: { password } });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set the password.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard?.writeText(`Email: ${email}\nPassword: ${password}`).catch(() => {});
    setCopied(true);
  };

  return (
    <Dialog
      open={open}
      title={done ? "Password set" : `Reset ${name}'s password`}
      onClose={onClose}
      footer={
        done ? (
          <>
            <Button variant="secondary" onClick={copy}>{copied ? "Copied" : "Copy login details"}</Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} busy={busy}>Set password</Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3 text-[15px]">
          <p>{name} is logged out everywhere. Give them these details; they can change the password in the app.</p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-lg bg-omr-paper px-4 py-3">
            <dt className="text-omr-lead">Email</dt>
            <dd className="font-medium">{email}</dd>
            <dt className="text-omr-lead">Password</dt>
            <dd className="font-medium">{password}</dd>
          </dl>
        </div>
      ) : (
        <>
          <p className="text-[15px] text-omr-lead">{name} will be logged out on every device and must use the new password. Any lockout from wrong guesses is cleared.</p>
          <Field
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="off"
            hint="At least 8 characters."
            action={<Button variant="secondary" onClick={() => setPassword(generatePassword())}>Generate</Button>}
          />
          <ErrorNote message={error} />
        </>
      )}
    </Dialog>
  );
}
