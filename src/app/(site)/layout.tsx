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
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </>
  );
}
