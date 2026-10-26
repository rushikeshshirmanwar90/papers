"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bubble, adminFetch } from "../ui";

const NAV = [
  { href: "/admin", label: "Dashboard", match: (p: string) => p === "/admin" },
  { href: "/admin/tuitions", label: "Tuitions", match: (p: string) => p.startsWith("/admin/tuitions") },
  { href: "/admin/support", label: "Support", match: (p: string) => p.startsWith("/admin/support") },
];

/** The console: a sidebar whose answer bubble marks where you are, and the page. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const logOut = async () => {
    await adminFetch("/api/admin/session", { method: "DELETE" }).catch(() => {});
    window.location.href = "/admin/login";
  };

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-1">
      {NAV.map((item) => {
        const on = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-omr-pink ${
              on ? "bg-omr-paper font-semibold text-omr-ink" : "text-omr-lead hover:text-omr-ink"
            }`}
          >
            <Bubble on={on} tone="pink" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      {/* Phones: a top bar with a menu. */}
      <div className="flex items-center justify-between border-b border-omr-rule bg-omr-sheet px-4 py-3 md:hidden">
        <span className="font-semibold">PCMB Admin</span>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="admin-menu"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-md border border-omr-rule px-3 py-1.5 text-sm font-medium"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      {menuOpen ? (
        <div id="admin-menu" className="space-y-4 border-b border-omr-rule bg-omr-sheet p-4 md:hidden">
          {nav}
          <button type="button" onClick={logOut} className="px-3 text-sm font-medium text-omr-lead hover:text-omr-ink">
            Log out
          </button>
        </div>
      ) : null}

      {/* Wider screens: the sidebar. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-omr-rule bg-omr-sheet px-4 py-6 md:flex">
        <div className="space-y-8">
          <div className="px-3">
            <p className="text-[17px] font-bold">PCMB Admin</p>
            <p className="text-sm text-omr-lead">Tuition network</p>
          </div>
          {nav}
        </div>
        <button type="button" onClick={logOut} className="rounded-lg px-3 py-2 text-left text-sm font-medium text-omr-lead hover:text-omr-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-omr-pink">
          Log out
        </button>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-10">
        <div className="mx-auto max-w-[1100px] space-y-8">{children}</div>
      </main>
    </div>
  );
}
