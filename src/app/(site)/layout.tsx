import Link from "next/link";

// The paper reader: upload, extract and review question papers.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
              PCMB <span className="text-indigo-600">Paper Reader</span>
            </Link>
            <nav className="flex gap-6 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-indigo-600">
                Dashboard
              </Link>
              <Link href="/papers" className="hover:text-indigo-600">
                Papers
              </Link>
              <Link href="/papers/upload" className="hover:text-indigo-600">
                Upload Paper
              </Link>
              <Link href="/privacy" className="hover:text-indigo-600">
                Privacy Policy
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4 text-xs text-slate-400">
            <span>© {new Date().getFullYear()} PCMB Paper Reader</span>
            <div className="flex gap-5">
              <Link href="/privacy" className="hover:text-slate-600">Privacy Policy</Link>
              <Link href="/account/delete" className="hover:text-red-600">Delete Account</Link>
            </div>
          </div>
        </footer>
    </>
  );
}
