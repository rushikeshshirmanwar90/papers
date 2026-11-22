import Link from "next/link";

// Public pages for the Quest mobile app (App Store marketing + support URLs).
// Kept apart from (site), whose header is the paper reader's admin nav.

export default function QuestPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[#FFFAF0] text-[#2B3350]">
      <header className="border-b border-[#ECDCB8]">
        <div className="mx-auto flex min-h-16 w-full max-w-4xl items-center justify-between gap-4 px-5">
          <Link href="/about" className="flex items-center gap-2.5 text-xl font-extrabold text-[#17213D]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/quest/mark.png" alt="" width={24} height={28} />
            Quest
          </Link>
          <nav className="flex gap-5 text-[15px] text-[#5D6478]">
            <Link href="/support" className="hover:text-[#17213D]">Support</Link>
            <Link href="/privacy" className="hover:text-[#17213D]">Privacy</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-[#ECDCB8]">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap justify-between gap-3 px-5 py-6 text-sm text-[#5D6478]">
          <span>© {new Date().getFullYear()} Quest</span>
          <div className="flex gap-4">
            <Link href="/support" className="hover:text-[#17213D]">Support</Link>
            <Link href="/privacy" className="hover:text-[#17213D]">Privacy Policy</Link>
            <Link href="/account/delete" className="hover:text-[#17213D]">Delete Account</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
